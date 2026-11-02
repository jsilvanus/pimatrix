# Sound on the Atlona: only output 1 (the left projector) reaches the PA

Set by Juha 2026-11-02. This is how the church is wired, not something pimatrix controls.

## The rule

- Any HDMI that reaches **Atlona output 1 (Proj1, the left projector)** has its audio taken out and put separately into the **PA**, whether or not the projector is on. That is the one path where sound is heard.
- A picture routed to any other output, for example the right projector (output 2), is silent as far as the room goes.
- So the system has **one sound lane**, not one per output. Which source is heard is decided by what is routed to output 1.

## What it means for the Pi

- The Pi's `hdmi0` goes to Atlona input 3 and `hdmi1` to input 4. Sound from a Pi HDMI output is heard in the PA only while that input is routed to output 1.
- [piprogram](https://github.com/jsilvanus/piprogram) can give each of its three feeds audio content next to the picture (since piprogram #9). It only outputs the feed and does not know the Atlona route. Whether a played sound reaches the PA depends on the route to output 1, which AMX owns (pimatrix and pigateway only ask AMX for it).
- pimatrix's own HDMI player starts `ffplay` with `-an`, so it never outputs sound. Only piprogram's stage page plays audio.
- Check the route to output 1 before playing anything meant for the room, and keep sound armed for only as long as it is needed (see the piprogram README, "Audio and the basic image": arm state, gain cap and the kill switch `POST /api/v1/pipgm/audio/kill`).
- Output 5 mirrors output 4 (see [atlona-output-mirror.md](atlona-output-mirror.md)); that has no bearing on sound, which is taken from output 1 only.

## Not verified

- How the audio is taken from output 1 (the Atlona's own audio out, the projector, or something else) is not written down here. Confirm it on site before relying on it for anything beyond the rule above.
- Nothing here has been tried with a real sound from the Pi.
