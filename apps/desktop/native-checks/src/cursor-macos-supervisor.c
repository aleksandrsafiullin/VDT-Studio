#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/event.h>
#include <sys/mount.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static int is_readonly_mount(const char *root) {
    struct statfs volume;
    return statfs(root, &volume) == 0 &&
           (volume.f_flags & MNT_RDONLY) != 0 &&
           strcmp(volume.f_mntonname, root) == 0;
}

int main(int argc, char **argv) {
    if (argc == 3 && strcmp(argv[1], "--check-readonly-mount") == 0) {
        return is_readonly_mount(argv[2]) ? 0 : 70;
    }

    if (argc < 7 || strcmp(argv[1], "--run") != 0 ||
        !is_readonly_mount(argv[2])) {
        return 70;
    }

    const pid_t controller = getppid();
    if (controller <= 1) return 70;
    sigset_t signals;
    sigemptyset(&signals);
    sigaddset(&signals, SIGTERM);
    sigaddset(&signals, SIGINT);
    if (sigprocmask(SIG_BLOCK, &signals, NULL) != 0) return 70;

    const int queue = kqueue();
    if (queue == -1) return 70;
    struct kevent events[3];
    EV_SET(&events[0], controller, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
    EV_SET(&events[1], SIGTERM, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&events[2], SIGINT, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    if (kevent(queue, events, 3, NULL, 0, NULL) != 0 ||
        getppid() != controller) return 70;

    /* Rewrite the private control arguments as sandbox-exec's fixed prefix. */
    argv[1] = "/usr/bin/sandbox-exec";
    argv[2] = "-p";
    sigset_t empty;
    sigemptyset(&empty);
    posix_spawnattr_t attributes;
    if (posix_spawnattr_init(&attributes) != 0) return 70;
    posix_spawn_file_actions_t files;
    if (posix_spawn_file_actions_init(&files) != 0) {
        posix_spawnattr_destroy(&attributes);
        return 70;
    }
    const int configured =
        posix_spawn_file_actions_addinherit_np(&files, STDIN_FILENO) == 0 &&
        posix_spawn_file_actions_addinherit_np(&files, STDOUT_FILENO) == 0 &&
        posix_spawn_file_actions_addinherit_np(&files, STDERR_FILENO) == 0 &&
        posix_spawnattr_setsigmask(&attributes, &empty) == 0 &&
        posix_spawnattr_setpgroup(&attributes, 0) == 0 &&
        posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETSIGMASK |
            POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT) == 0;
    pid_t child;
    const int spawned = configured &&
        posix_spawn(&child, argv[1], &files, &attributes, &argv[1], environ) == 0;
    posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attributes);
    if (!spawned) return 70;

    struct kevent child_event;
    EV_SET(&child_event, child, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
    int event_count = kevent(queue, &child_event, 1, NULL, 0, NULL);
    if (event_count == 0) {
        do {
            event_count = kevent(queue, NULL, 0, events, 3, NULL);
        } while (event_count < 0 && errno == EINTR);
    }
    int child_exited = 0;
    for (int i = 0; i < event_count; i++) {
        if (events[i].filter == EVFILT_PROC && events[i].ident == (uintptr_t)child) {
            child_exited = 1;
        }
    }
    if (!child_exited) kill(-child, SIGKILL);
    int status;
    pid_t reaped;
    do {
        reaped = waitpid(child, &status, 0);
    } while (reaped < 0 && errno == EINTR);
    close(queue);
    if (reaped != child) return 70;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 70;
}
