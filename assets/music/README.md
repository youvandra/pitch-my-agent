# Backing tracks

Drop licensed audio here and the renderer uses it instead of the synthesized
bed. An empty directory is fine — synthesis is the fallback, not an error.

## Naming is the contract

    <style>-<bpm>.<mp3|m4a|wav|aac>

    terminal-112.mp3
    playful-124.mp3
    saas-96.mp3

The BPM in the filename is not decoration. Every cut, every entrance and every
caption in the template is quantized to that grid, so a wrong number
desynchronises the whole video. A file whose name does not match the pattern is
skipped rather than guessed at.

`<style>` matches the video style (`terminal`, `playful`, `saas`). Several
tracks may share a style — one is chosen per agent, seeded by agent id, so the
same agent always gets the same bed and two agents rarely share one. If a style
has no track of its own, any track in the library is used before falling back to
synthesis.

## Licensing

These videos are sold. Only put files here that are cleared for commercial use —
CC0, or a royalty-free licence you hold. Keep the licence or its URL next to the
file in `LICENCES.md`; nothing in the pipeline can verify this, and a buyer
receiving an infringing video is the seller's problem, not the renderer's.
