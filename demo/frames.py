"""Frame capture and GIF assembly for demo/record.sh.

  frames.py capture <window-id> <dir>   screenshot the window until <dir>/stop exists
  frames.py build <dir> <out-base>      write <out-base>.gif and <out-base>.mp4
"""

import os
import subprocess
import sys
import time


def capture(window, out):
    start = time.time()
    n = 0
    with open(os.path.join(out, "times.txt"), "w") as log:
        while not os.path.exists(os.path.join(out, "stop")) and time.time() - start < 600:
            path = os.path.join(out, f"{n:05d}.png")
            subprocess.run(["screencapture", "-x", "-o", f"-l{window}", path], check=False)
            if os.path.exists(path):
                log.write(f"{path} {time.time() - start:.3f}\n")
                log.flush()
                n += 1
            time.sleep(0.08)


def signature(path):
    # A small grey thumbnail: spinner ticks and cursor blinks barely move it.
    return subprocess.run(
        ["magick", path, "-resize", "96x60!", "-colorspace", "gray", "-depth", "8", "gray:-"],
        capture_output=True,
        check=True,
    ).stdout


def build(out, base):
    rows = [line.split() for line in open(os.path.join(out, "times.txt"))]
    frames = [(p, float(t)) for p, t in rows]
    sigs = [signature(p) for p, _ in frames]
    keep = []
    for i, (path, t) in enumerate(frames):
        held = (frames[i + 1][1] if i + 1 < len(frames) else t + 2.5) - t
        if keep:
            prev = sigs[keep[-1][2]]
            diff = sum(abs(a - b) for a, b in zip(sigs[i], prev)) / len(prev)
            if diff < 0.12:
                keep[-1][1] += held
                continue
        keep.append([path, held, i])
    # Long waits (Claude thinking, Claude Code starting) collapse to a beat.
    for k in keep:
        k[1] = min(k[1], 1.4)
    keep[-1][1] = 3.0
    listing = os.path.join(out, "list.txt")
    with open(listing, "w") as f:
        for path, held, _ in keep:
            f.write(f"file '{path}'\nduration {held:.3f}\n")
        f.write(f"file '{keep[-1][0]}'\n")
    scale = "scale=1100:-1:flags=lanczos"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
         "-vf", f"{scale},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];"
                "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
         "-fps_mode", "vfr", f"{base}.gif"],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
         "-vf", "scale=1600:-2:flags=lanczos,fps=30", "-pix_fmt", "yuv420p", f"{base}.mp4"],
        check=True,
    )
    print(f"{len(frames)} frames -> {len(keep)} kept, {sum(k[1] for k in keep):.1f}s: {base}.gif, {base}.mp4")


if __name__ == "__main__":
    if sys.argv[1] == "capture":
        capture(sys.argv[2], sys.argv[3])
    else:
        build(sys.argv[2], sys.argv[3])
