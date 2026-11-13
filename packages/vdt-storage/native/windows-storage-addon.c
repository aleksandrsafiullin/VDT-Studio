#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct StorageSession StorageSession;
extern uint32_t vdt_storage_open(const char *, size_t, uint8_t, StorageSession **);
extern uint32_t vdt_storage_open_child(StorageSession *, const char *, size_t, uint8_t, StorageSession **);
extern uint32_t vdt_storage_write(StorageSession *, const char *, size_t, const void *, size_t);
extern uint32_t vdt_storage_publish(StorageSession *, const char *, size_t, const char *, size_t, const void *, size_t);
extern uint32_t vdt_storage_replace(StorageSession *, const char *, size_t, const char *, size_t, const void *, size_t, const void *, size_t);
extern uint32_t vdt_storage_read(StorageSession *, const char *, size_t, void *, size_t, uint8_t, size_t *);
typedef uint8_t (*EntryCallback)(void *, const char *, size_t, uint8_t, uint8_t);
typedef uint8_t (*TextCallback)(void *, const char *, size_t);
extern uint32_t vdt_storage_sqlite_path(StorageSession *, void *, TextCallback);
extern uint32_t vdt_storage_list(StorageSession *, void *, EntryCallback);
extern uint32_t vdt_storage_remove_empty_child(StorageSession *, const char *, size_t);
extern uint32_t vdt_storage_ensure_child(StorageSession *, const char *, size_t);
extern uint32_t vdt_storage_unlink(StorageSession *, const char *, size_t);
extern uint32_t vdt_storage_flush(StorageSession *);
extern void vdt_storage_close(StorageSession *);

typedef struct {
  StorageSession *native;
} Session;

typedef struct StorageLock StorageLock;
extern uint32_t vdt_storage_acquire_lock(StorageSession *, const char *, size_t, StorageLock **);
extern void vdt_storage_release_lock(StorageLock *);

typedef struct {
  StorageLock *native;
} Lock;

static const napi_type_tag lock_tag = {
  UINT64_C(0x683ac3ab803849a0), UINT64_C(0xb932ed133266e291)
};

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
    case 33:
    case 32: code = "EBUSY"; break;
    case 50: code = "ENOTSUP"; break;
    case 80: case 183: code = "EEXIST"; break;
    case 87: code = "EINVAL"; break;
    case 1306: code = "ESTALE"; break;
    case 145: code = "ENOTEMPTY"; break;
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

static napi_value wrap_session(napi_env env, Session *session, uint32_t error) {
  if (error != 0) {
    free(session);
    return win32_fail(env, error);
  }
  napi_value object;
  if (napi_create_object(env, &object) != napi_ok ||
      napi_type_tag_object(env, object, &session_tag) != napi_ok ||
      napi_wrap(env, object, session, finalize, NULL, NULL) != napi_ok) {
    finalize(env, session, NULL);
    return fail(env, "EIO", "Could not wrap Windows storage session");
  }
  return object;
}

static napi_value open_session(napi_env env, napi_callback_info info) {
  napi_value arg;
  void *create = NULL;
  size_t argc = 1;
  size_t length;
  char path[32768];
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, &create) != napi_ok || argc != 1 ||
      napi_get_value_string_utf8(env, arg, NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(path) ||
      napi_get_value_string_utf8(env, arg, path, sizeof(path), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a bounded Windows storage root path");
  }
  Session *session = calloc(1, sizeof(*session));
  if (session == NULL) return fail(env, "ENOMEM", "Could not allocate Windows storage session");
  uint32_t error = vdt_storage_open(path, length, create != NULL, &session->native);
  return wrap_session(env, session, error);
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
  napi_value args[5];
  void *replace = NULL;
  size_t argc = 5, stage_length, destination_length, byte_length;
  void *bytes;
  bool is_buffer = false;
  char stage[1021], destination[1021];
  if (napi_get_cb_info(env, info, &argc, args, NULL, &replace) != napi_ok || argc != (replace == NULL ? 4 : 5) ||
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
  if (replace != NULL) {
    void *previous;
    size_t previous_length;
    if (napi_is_buffer(env, args[4], &is_buffer) != napi_ok || !is_buffer ||
        napi_get_buffer_info(env, args[4], &previous, &previous_length) != napi_ok) {
      return fail(env, "EINVAL", "Expected previous destination bytes");
    }
    return result(env, vdt_storage_replace(session->native, stage, stage_length, destination,
        destination_length, previous, previous_length, bytes, byte_length));
  }
  return result(env, vdt_storage_publish(session->native, stage, stage_length, destination, destination_length, bytes, byte_length));
}

static napi_value read_file(napi_env env, napi_callback_info info) {
  napi_value args[4], result_value;
  size_t argc = 4, length, capacity, read = 0;
  char name[1021];
  bool is_buffer = false, durable = false;
  void *bytes;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 4 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &length) != napi_ok ||
      napi_is_buffer(env, args[2], &is_buffer) != napi_ok || !is_buffer ||
      napi_get_buffer_info(env, args[2], &bytes, &capacity) != napi_ok || capacity > UINT32_MAX ||
      napi_get_value_bool(env, args[3], &durable) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session, file name, bounded Buffer, and flush flag");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  uint32_t error = vdt_storage_read(session->native, name, length, bytes, capacity, durable ? 1 : 0, &read);
  if (error != 0) return win32_fail(env, error);
  if (napi_create_uint32(env, (uint32_t)read, &result_value) != napi_ok) {
    return fail(env, "EIO", "Could not return Windows storage read result");
  }
  return result_value;
}

typedef struct {
  napi_env env;
  napi_value array;
  uint32_t index;
} EntryResult;

static uint8_t append_entry(void *context, const char *name, size_t length, uint8_t directory, uint8_t reparse) {
  EntryResult *result = context;
  napi_env env = result->env;
  napi_value object, value;
  return napi_create_object(env, &object) == napi_ok &&
      napi_create_string_utf8(env, name, length, &value) == napi_ok &&
      napi_set_named_property(env, object, "name", value) == napi_ok &&
      napi_get_boolean(env, directory != 0, &value) == napi_ok &&
      napi_set_named_property(env, object, "directory", value) == napi_ok &&
      napi_get_boolean(env, reparse != 0, &value) == napi_ok &&
      napi_set_named_property(env, object, "reparse", value) == napi_ok &&
      napi_set_element(env, result->array, result->index++, object) == napi_ok;
}

typedef struct {
  napi_env env;
  napi_value value;
} TextResult;

static uint8_t return_text(void *context, const char *text, size_t length) {
  TextResult *result = context;
  return napi_create_string_utf8(result->env, text, length, &result->value) == napi_ok;
}

static napi_value sqlite_path(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t argc = 1;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1) {
    return fail(env, "EINVAL", "Expected one Windows storage session");
  }
  Session *session = get_session(env, arg);
  if (session == NULL || session->native == NULL) return fail(env, "EBADF", "Expected an open Windows storage session");
  TextResult output = {env, NULL};
  uint32_t error = vdt_storage_sqlite_path(session->native, &output, return_text);
  return error == 0 ? output.value : win32_fail(env, error);
}

static napi_value list_entries(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t argc = 1;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1) {
    return fail(env, "EINVAL", "Expected one Windows storage session");
  }
  Session *session = get_session(env, arg);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  EntryResult entries = {env, NULL, 0};
  if (napi_create_array(env, &entries.array) != napi_ok) return fail(env, "EIO", "Could not allocate storage entries");
  uint32_t error = vdt_storage_list(session->native, &entries, append_entry);
  return error == 0 ? entries.array : win32_fail(env, error);
}

typedef uint32_t (*NamedOperation)(StorageSession *, const char *, size_t);
static NamedOperation unlink_operation = vdt_storage_unlink;
static NamedOperation ensure_child_operation = vdt_storage_ensure_child;
static NamedOperation remove_empty_child_operation = vdt_storage_remove_empty_child;

static napi_value named_operation(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t argc = 2, length;
  char name[1021];
  void *operation = NULL;
  if (napi_get_cb_info(env, info, &argc, args, NULL, &operation) != napi_ok || argc != 2 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session and one file name");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  uint32_t error = (*(NamedOperation *)operation)(session->native, name, length);
  return result(env, error);
}

static napi_value open_child(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t argc = 2, length;
  char name[1021];
  void *create = NULL;
  if (napi_get_cb_info(env, info, &argc, args, NULL, &create) != napi_ok || argc != 2 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session and one directory name");
  }
  Session *parent = get_session(env, args[0]);
  if (parent == NULL || parent->native == NULL) {
    return fail(env, "EBADF", "Expected an open Windows storage session");
  }
  Session *child = calloc(1, sizeof(*child));
  if (child == NULL) return fail(env, "ENOMEM", "Could not allocate Windows storage session");
  uint32_t error = vdt_storage_open_child(parent->native, name, length, create != NULL, &child->native);
  return wrap_session(env, child, error);
}

static void finalize_lock(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  Lock *lock = data;
  vdt_storage_release_lock(lock->native);
  free(lock);
}

static napi_value acquire_lock(napi_env env, napi_callback_info info) {
  napi_value args[2], object;
  size_t argc = 2, length;
  char name[1021];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 2 ||
      napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length >= sizeof(name) ||
      napi_get_value_string_utf8(env, args[1], name, sizeof(name), &length) != napi_ok) {
    return fail(env, "EINVAL", "Expected a session and one lock name");
  }
  Session *session = get_session(env, args[0]);
  if (session == NULL || session->native == NULL) return fail(env, "EBADF", "Expected an open Windows storage session");
  Lock *lock = calloc(1, sizeof(*lock));
  if (lock == NULL) return fail(env, "ENOMEM", "Could not allocate Windows storage lock");
  uint32_t error = vdt_storage_acquire_lock(session->native, name, length, &lock->native);
  if (error != 0) {
    free(lock);
    return win32_fail(env, error);
  }
  if (napi_create_object(env, &object) != napi_ok ||
      napi_type_tag_object(env, object, &lock_tag) != napi_ok ||
      napi_wrap(env, object, lock, finalize_lock, NULL, NULL) != napi_ok) {
    finalize_lock(env, lock, NULL);
    return fail(env, "EIO", "Could not wrap Windows storage lock");
  }
  return object;
}

static napi_value release_lock(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t argc = 1;
  bool valid = false;
  Lock *lock = NULL;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1 ||
      napi_check_object_type_tag(env, arg, &lock_tag, &valid) != napi_ok || !valid ||
      napi_unwrap(env, arg, (void **)&lock) != napi_ok || lock == NULL) {
    return fail(env, "EBADF", "Expected a Windows storage lock");
  }
  vdt_storage_release_lock(lock->native);
  lock->native = NULL;
  return result(env, 0);
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
  static int close_marker, create_marker, create_child_marker, replace_marker;
  napi_property_descriptor properties[] = {
    {"open", NULL, open_session, NULL, NULL, NULL, napi_default, NULL},
    {"initialize", NULL, open_session, NULL, NULL, NULL, napi_default, &create_marker},
    {"openChild", NULL, open_child, NULL, NULL, NULL, napi_default, NULL},
    {"createChild", NULL, open_child, NULL, NULL, NULL, napi_default, &create_child_marker},
    {"writeExclusive", NULL, write_exclusive, NULL, NULL, NULL, napi_default, NULL},
    {"publish", NULL, publish_file, NULL, NULL, NULL, napi_default, NULL},
    {"replace", NULL, publish_file, NULL, NULL, NULL, napi_default, &replace_marker},
    {"read", NULL, read_file, NULL, NULL, NULL, napi_default, NULL},
    {"sqlitePath", NULL, sqlite_path, NULL, NULL, NULL, napi_default, NULL},
    {"list", NULL, list_entries, NULL, NULL, NULL, napi_default, NULL},
    {"unlink", NULL, named_operation, NULL, NULL, NULL, napi_default, &unlink_operation},
    {"ensureChild", NULL, named_operation, NULL, NULL, NULL, napi_default, &ensure_child_operation},
    {"removeEmptyChild", NULL, named_operation, NULL, NULL, NULL, napi_default, &remove_empty_child_operation},
    {"flush", NULL, flush_or_close, NULL, NULL, NULL, napi_default, NULL},
    {"acquireLock", NULL, acquire_lock, NULL, NULL, NULL, napi_default, NULL},
    {"releaseLock", NULL, release_lock, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, flush_or_close, NULL, NULL, NULL, napi_default, &close_marker}
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
    return fail(env, "EIO", "Could not initialize Windows storage addon");
  }
  return exports;
}
