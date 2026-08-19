# 0006 Local socket not loopback HTTP

`coordyd` listens on a Unix domain socket or Windows named pipe plus a 0600 token. It does not bind a localhost TCP port.
