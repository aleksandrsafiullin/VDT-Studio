use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    os::unix::net::UnixStream,
    sync::Mutex,
    time::Duration,
};

const MAX_REQUEST_BYTES: usize = 551_024;
const MAX_RESPONSE_BYTES: usize = 128 * 1024;
const UNAVAILABLE: &str = "The private speech bridge is unavailable.";

/// Fixes which private transport owns a single capture. The ordinary Tauri
/// command can still use the existing recognizer for manual dictation.
#[derive(Default)]
pub(crate) struct PackagedSpeech {
    capture: Mutex<Option<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: String,
    speech: Value,
}

impl PackagedSpeech {
    pub(crate) fn invoke(
        &self,
        speech: Value,
        dispatch: impl FnOnce(Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        self.request(speech, false, dispatch)
    }

    fn request(
        &self,
        speech: Value,
        from_web_host: bool,
        dispatch: impl FnOnce(Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let mut capture = self.capture.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        let operation = speech.get("operation").and_then(Value::as_str).unwrap_or("");
        let is_open = operation == "open_session";
        let is_close = operation == "close_session";
        let session = speech.get("sessionId").and_then(Value::as_str);
        let is_owned = capture.as_deref().is_some_and(|id| Some(id) == session);
        if from_web_host {
            // The underlying recognizer enforces exclusivity and expires an
            // abandoned capture before it admits a fresh opening.
            if !is_open && (!is_owned
                || !matches!(operation, "keep_session" | "transcribe" | "result" | "cancel" | "close_session"))
            {
                return Err("The private voice capture no longer matches this session.".into());
            }
        } else if is_owned {
            return Err("This voice capture belongs to the packaged web host.".into());
        }

        let result = dispatch(speech);
        if from_web_host && is_open {
            if let Ok(payload) = &result {
                if payload.get("state").and_then(Value::as_str) == Some("open") {
                    let id = payload.get("sessionId").and_then(Value::as_str).filter(|id| valid_id(id))
                        .ok_or_else(|| UNAVAILABLE.to_owned())?;
                    *capture = Some(id.to_owned());
                }
            }
        } else if from_web_host && is_close {
            *capture = None;
        }
        result
    }

    pub(crate) fn serve(
        &self,
        socket: UnixStream,
        mut dispatch: impl FnMut(Value) -> Result<Value, String>,
    ) -> io::Result<()> {
        let result = self.serve_frames(socket, &mut dispatch);
        if let Ok(mut owner) = self.capture.lock() {
            if let Some(id) = owner.take() {
                let _ = dispatch(json!({"operation": "close_session", "sessionId": id}));
            }
        }
        result
    }

    fn serve_frames(
        &self,
        socket: UnixStream,
        dispatch: &mut impl FnMut(Value) -> Result<Value, String>,
    ) -> io::Result<()> {
        socket.set_write_timeout(Some(Duration::from_secs(5)))?;
        let mut writer = socket.try_clone()?;
        let mut reader = BufReader::new(socket);
        let mut line = Vec::new();
        loop {
            line.clear();
            let bytes = reader.by_ref().take((MAX_REQUEST_BYTES + 1) as u64).read_until(b'\n', &mut line)?;
            if bytes == 0 { return Ok(()); }
            if bytes > MAX_REQUEST_BYTES || line.last() != Some(&b'\n') { return Err(invalid_frame()); }
            let frame: Request = serde_json::from_slice(&line).map_err(|_| invalid_frame())?;
            if !valid_id(&frame.id) { return Err(invalid_frame()); }
            let response = match self.request(frame.speech, true, &mut *dispatch) {
                Ok(speech) => json!({ "id": frame.id, "ok": true, "speech": speech }),
                Err(error) => json!({ "id": frame.id, "ok": false, "error": error }),
            };
            let response = serde_json::to_vec(&response).map_err(|_| invalid_frame())?;
            if response.len() >= MAX_RESPONSE_BYTES { return Err(invalid_frame()); }
            writer.write_all(&response)?;
            writer.write_all(b"\n")?;
        }
    }
}

fn valid_id(value: &str) -> bool {
    value.len() == 36 && value.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn invalid_frame() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid private speech bridge frame")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::Shutdown, thread};

    #[test]
    fn bridge_never_claims_direct_sessions_and_direct_commands_cannot_reuse_bridge_sessions() {
        let bridge = PackagedSpeech::default();
        let session = "2a1d3618-bf13-414a-b817-899815ef2fd9";
        let job = json!({"operation": "result", "sessionId": session});
        assert!(bridge.request(job.clone(), true, |_| panic!("direct session cannot reach IPC")).is_err());
        bridge.request(json!({"operation": "open_session"}), true, |_| {
            Ok(json!({"state": "open", "sessionId": session}))
        }).unwrap();
        assert!(bridge.invoke(job.clone(), |_| panic!("native invoke cannot access captured session")).is_err());
        assert!(bridge.request(job, true, |_| Ok(json!({"state": "processing"}))).is_ok());
        assert!(bridge.request(json!({"operation": "tts_result", "sessionId": session}), true, |_| {
            panic!("synthesis cannot travel through the capture bridge")
        }).is_err());
    }

    #[test]
    fn closes_the_owned_session_when_the_web_process_disconnects() {
        let bridge = PackagedSpeech::default();
        let session = "2a1d3618-bf13-414a-b817-899815ef2fd9";
        let (mut client, server) = UnixStream::pair().unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        thread::scope(|scope| {
            let worker = scope.spawn(|| {
                let mut operations = Vec::new();
                bridge.serve(server, |request| {
                    operations.push(request.clone());
                    Ok(json!({"state": "open", "sessionId": session}))
                }).unwrap();
                operations
            });
            let open = json!({"id": session, "speech": {"operation": "open_session"}});
            writeln!(client, "{open}").unwrap();
            let mut reply = String::new();
            BufReader::new(client.try_clone().unwrap()).read_line(&mut reply).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&reply).unwrap()["speech"]["sessionId"], session);
            client.shutdown(Shutdown::Both).unwrap();
            assert_eq!(worker.join().unwrap(), vec![json!({"operation": "open_session"}),
                json!({"operation": "close_session", "sessionId": session})]);
        });
    }

    #[test]
    fn rejects_an_oversized_frame_without_dispatching_to_the_sidecar() {
        let (mut client, server) = UnixStream::pair().unwrap();
        thread::scope(|scope| {
            let worker = scope.spawn(|| PackagedSpeech::default()
                .serve(server, |_| panic!("oversized frame must not reach sidecar")));
            client.write_all(&vec![b' '; MAX_REQUEST_BYTES + 1]).unwrap();
            assert_eq!(worker.join().unwrap().unwrap_err().kind(), io::ErrorKind::InvalidData);
        });
    }
}
