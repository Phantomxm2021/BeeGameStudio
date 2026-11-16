#!/usr/bin/env python3
"""Original four-bar MIDI study. Requires Mido only when writing MIDI.

Instrument numbers are zero-based General MIDI examples. Choose programs and
articulation from the actual licensed SoundFont; this file supplies no soundbank,
audio renderer or quality verdict. Adapt a project-owned copy, not this package.
"""

import argparse
from pathlib import Path


def arrangement_study(repeats=1):
    from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

    if repeats < 1:
        raise ValueError("repeats must be positive")
    midi = MidiFile(type=1, ticks_per_beat=480)
    period = 16 * midi.ticks_per_beat
    end = period * repeats
    midi.tracks.append(MidiTrack([
        MetaMessage("track_name", name="Four-bar study"),
        MetaMessage("set_tempo", tempo=bpm2tempo(96)),
        MetaMessage("time_signature", numerator=4, denominator=4),
        MetaMessage("end_of_track", time=end),
    ]))

    # Preserve the original offbeat A, varied A, descending answer and ending.
    # Tuples are local authored (quarter-note onset, length, MIDI note, velocity).
    bars = [
        [(0.25, 0.5, 62, 88), (0.75, 0.5, 65, 66),
         (1.5, 0.5, 69, 88), (2, 0.5, 65, 62)],
        [(0.25, 0.5, 62, 88), (0.75, 0.5, 65, 66),
         (1.5, 0.5, 67, 88), (2, 0.5, 64, 62)],
        [(0.25, 0.5, 70, 88), (0.75, 0.5, 69, 66),
         (1.5, 0.5, 67, 88), (2, 0.5, 65, 62)],
        [(0.25, 0.5, 65, 88), (0.75, 0.5, 64, 66),
         (1.5, 1, 62, 88)],
    ]
    melody = [(bar * 4 + at, length, note, velocity)
              for bar, notes in enumerate(bars)
              for at, length, note, velocity in notes]
    harmony = [(bar * 4, 2, note, 48)
               for bar, chord in enumerate([(50, 53, 57), (46, 50, 53),
                                             (43, 46, 50), (50, 53, 57)])
               for note in chord]
    bass = [(bar * 4, 2.5, note, 76)
            for bar, note in enumerate([38, 46, 43, 38])]

    # Example programs: acoustic piano, electric piano and acoustic bass.
    # Each part has its own channel so programs and controls remain independent.
    for channel, (name, program, notes) in enumerate([
        ("Lead", 0, melody), ("Harmony", 4, harmony), ("Bass", 32, bass),
    ]):
        track = MidiTrack([
            MetaMessage("track_name", name=name),
            Message("program_change", channel=channel, program=program),
        ])
        events = []
        for repetition in range(repeats):
            for at, length, note, velocity in notes:
                start = repetition * period + round(at * midi.ticks_per_beat)
                stop = start + round(length * midi.ticks_per_beat)
                events.extend([
                    (start, Message("note_on", channel=channel, note=note,
                                    velocity=velocity)),
                    (stop, Message("note_off", channel=channel, note=note)),
                ])
        # Stop a previous note before restarting it at the same tick.
        events.sort(key=lambda event: (event[0], event[1].type != "note_off"))
        previous = 0
        for tick, message in events:
            track.append(message.copy(time=tick - previous))
            previous = tick
        track.append(MetaMessage("end_of_track", time=end - previous))
        midi.tracks.append(track)
    return midi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New .mid file in an existing directory")
    parser.add_argument("--repeats", type=int, default=1,
                        help="Consecutive four-bar periods for loop preparation (default: 1)")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    if args.output.suffix.lower() != ".mid":
        parser.error("output must use .mid")
    try:
        midi = arrangement_study(args.repeats)
        with args.output.open("xb") as output:
            midi.save(file=output)
    except ModuleNotFoundError as error:
        if error.name != "mido":
            raise
        parser.exit(1, "Mido is required to write MIDI. No dependency was installed or downloaded.\n")
    except OSError as error:
        parser.exit(1, f"Cannot write MIDI: {error}\n")
    print(f"Wrote {args.output}: {args.repeats} period(s), 10 seconds per period. "
          "Audio rendering, seamless looping and listening quality remain unverified.")


if __name__ == "__main__":
    main()
