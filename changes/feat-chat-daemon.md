- Argus chat runs in one background process per user instead of inside each window, so closing or reloading a window
  no longer stops its chats. A reply still running finishes, and reopening the chat shows it. Windows talk to the
  process over a local socket, so no network calls are added.
