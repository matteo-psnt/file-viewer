#!/bin/sh
# cell.sh: the size of the terminal Claude Code runs in, as "rows columns
# width height" (cells, then pixels), so pictures keep their shape whatever the
# font. Prints nothing where it can't tell.
#
# A hooks process has no terminal of its own, so this walks up to the nearest
# parent that has one and asks it (TIOCGWINSZ). Perl does the asking: it ships
# with macOS and Linux, where python3 on a Mac without the developer tools
# opens an install dialog instead.

pid=$$
tty=
i=0
while [ "$i" -lt 30 ] && [ "$pid" -gt 1 ]; do
  # shellcheck disable=SC2046 # split "ppid tty" into two fields
  set -- $(ps -o ppid= -o tty= -p "$pid" 2>/dev/null)
  [ $# -ge 2 ] || exit 0
  case $2 in
    '?' | '??' | -) pid=$1 ;;
    *) tty=/dev/${2#/dev/}; break ;;
  esac
  i=$((i + 1))
done
[ -n "$tty" ] || exit 0

# TIOCGWINSZ: 0x40087468 on macOS, 0x5413 on Linux.
case $(uname -s) in
  Darwin) request=1074295912 ;;
  *) request=21523 ;;
esac
# O_NOCTTY, so opening the terminal never makes it this process's own.
exec perl -MFcntl -e '
  sysopen(my $t, $ARGV[0], O_RDONLY | O_NOCTTY) or exit;
  my $size = "\0" x 8;
  ioctl($t, $ARGV[1], $size) or exit;
  print join(" ", unpack("S4", $size)), "\n";
' "$tty" "$request"
