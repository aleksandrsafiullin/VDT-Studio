#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct StorageSession StorageSession;
extern uint32_t vdt_storage_open(const char *, size_t, StorageSession **);
extern uint32_t vdt_storage_write(StorageSession *, const char *, size_t, const void *, size_t);
extern uint32_t vdt_storage_publish(StorageSession *, const char *, size_t, const char *, size_t, const void *, size_t);
extern uint32_t vdt_storage_unlink(StorageSession *, const char *, size_t);
extern uint32_t vdt_storage_flush(StorageSession *);
extern void vdt_storage_close(StorageSession *);

typedef struct {
  StorageSession *native;
} Session;

static const napi_type_tag session_tag = {
  UINT64_C(0x3448519ba74ed10b), UINT64_C(0xaf2346be09ea85fd)
};

static napi_value fail(napi_env env, const char *code, const char *message) {
  napi_throw_error(env, code, message);
  return NULL;
}

static napi_value win32_fail(napi_env env, uint32_t error) {
  const char *code = "EIO";
  switch (error) {
    case 2: case 3: code = "ENOENT"; break;
    case 5: code = "EACCES"; break;
    case 13: code = "EBADMSG"; break;
    case 32: code = "EBUSY"; break;
    case 50: code = "ENOTSUP"; break;
    case 80: case 183: code = "EEXIST"; break;
    case 87: code = "EINVAL"; break;
    case 112: code = "ENOSPC"; break;
  }
  napi_value message, kind, exception, number;
  if (napi_create_string_utf8(env, "Windows storage operation failed", NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &kind) != napi_ok ||
      napi_create_error(env, kind, message, &exception) != napi_ok ||
      napi_create_uint32(env, error, &number) != napi_ok ||
      napi_set_named_property(env, exception, "win32Error", number) != napi_ok) {
    return fail(env, "EIO", "Could not report Windows storage error");
  }
  napi_throw(env, exception);
  return NULL;
}

static void finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  Session *session = data;
  vdt_storage_close(session->native);
  free(session);
}

static Session *get_session(napi_env env, napi_value value) {
  bool valid = false;
  Session *session = NULL;
  if (napi_check_object_type_tag(env, value, &session_tag, &valid) != napi_ok || !valid ||
      napi_unwrap(env, value, (void **)&session) != napi_ok) {
    return NULL;
  }
  return session;
}

static napi_value result(napi_env env, uint32_t error) {
  if (error != 0) return win32_fail(env, error);
  napi_value undefined;
  if (napi_get_undefined(env, &undefined) != napi_ok) {
    return fail(env, "EIO", "Could not return Windows storage result");
  }
  return undefined;
}

static napi_value open_session(napi_env env, napi_callback_info info) {
  napi_value arg, object;
  size_t argc = 1;
  size_t length;
  char path[32768];
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_string_utf8(env, arg, NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(path) ||
      napi_get_value_string_utf8(env, arg, path, sizeof(path), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a bounded Windows storage root path");
  }
  Session *session = calloc(1, sizeof(*session));
  if (session == NULL) return fail(env, "ENOMEM", "Could not allocate Windows storage session");
  uint32_t error = vdt_storage_open(path, length, &session->native);
  if (error != 0) {
    free(session);
    return win32_fail(env, error);
  }
  if (napi_create_object(env, &object) != napi_ok ||
      napi_type_tag_object(env, object, &session_tag) != napi_ok ||
      napi_wrap(env, object, session, finalize, NULL, NULL) != napi_ok) {
    finalize(env, session, NULL);
    return fail(env, "EIO", "Could not wrap Windows storage session");
  }
  return object;
}

static napi_value write_exclusive(napi_env env, napi_callback_info info) {
  napi_value args[3];
  size_t argc = 3;
  size_t name_length, byte_length;
  char name[1021];
  void *bytes;
  bool is_buffer = false;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 3 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &name_length) != napi_ok ||
      name_length == 0 || name_length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &name_length) != napi_ok ||
      napi_is_buffer(env, args[2], &is_buffer) != napi_ok || !is_buffer ||
      napi_get_buffer_info(env, args[2], &bytes, &byte_length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session, one file name, and a Buffer");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  return result(env, vdt_storage_write(session->native, name, name_length, bytes, byte_length));
}

static napi_value publish_file(napi_env env, napi_callback_info info) {
  napi_value args[4];
  size_t argc = 4, stage_length, destination_length, byte_length;
  void *bytes;
  bool is_buffer = false;
  char stage[1021], destination[1021];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 4 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &stage_length) != napi_ok ||
      stage_length == 0 || stage_length >= sizeof(stage) ||
      napi_get_value_string_utf8(env, args[1], stage, sizeof(stage), &stage_length) != napi_ok ||
      napi_get_value_string_utf8(env, args[2], NULL, 0, &destination_length) != napi_ok ||
      destination_length == 0 || destination_length >= sizeof(destination) ||
      napi_get_value_string_utf8(env, args[2], destination, sizeof(destination), &destination_length) != napi_ok ||
      napi_is_buffer(env, args[3], &is_buffer) != napi_ok || !is_buffer ||
      napi_get_buffer_info(env, args[3], &bytes, &byte_length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session, stage file name, destination file name, and expected bytes");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  return result(env, vdt_storage_publish(session->native, stage, stage_length, destination, destination_length, bytes, byte_length));
}

static napi_value unlink_file(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t argc = 2, length;
  char name[1021];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 2 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session and one file name");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  return result(env, vdt_storage_unlink(session->native, name, length));
}

static napi_value flush_or_close(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t argc = 1;
  void *close = NULL;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, &close) != napi_ok || argc != 1) {
    return fail(env, "EINVAL", "Expected one Windows storage session");
  }
  Session *session = get_session(env, arg);
  if (session == NULL || (close == NULL && session->native == NULL)) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  if (close == NULL) return result(env, vdt_storage_flush(session->native));
  vdt_storage_close(session->native);
  session->native = NULL;
  return result(env, 0);
}

NAPI_MODULE_INIT() {
  static int close_marker;
  napi_property_descriptor properties[] = {
    {"open", NULL, open_session, NULL, NULL, NULL, napi_default, NULL},
    {"writeExclusive", NULL, write_exclusive, NULL, NULL, NULL, napi_default, NULL},
    {"publish", NULL, publish_file, NULL, NULL, NULL, napi_default, NULL},
    {"unlink", NULL, unlink_file, NULL, NULL, NULL, napi_default, NULL},
    {"flush", NULL, flush_or_close, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, flush_or_close, NULL, NULL, NULL, napi_default, &close_marker}
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
    return fail(env, "EIO", "Could not initialize Windows storage addon");
  }
  return exports;
}
