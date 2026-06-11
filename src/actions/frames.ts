/**
 * Frame loader — eagerly imports sprite frames for each action directory.
 *
 * Vite requires `import.meta.glob` patterns to be static string literals,
 * so each action directory gets its own explicit glob.  The keys here
 * MUST match the `dir` field of the corresponding entry in `./index.ts`.
 *
 * To add a new action:
 * 1. Drop frames under `src/assets/<new-dir>/` as `frame_XXXXXX.webp`.
 * 2. Copy one of the glob blocks below, replacing the directory name.
 * 3. Add the key to the `FRAMES` record.
 */

const wikiFrames = import.meta.glob<string>(
  "../../assets/cat-webp-wiki/*.webp",
  { eager: true, import: "default" },
)

export const FRAMES: Record<string, string[]> = {
  wiki: Object.keys(wikiFrames)
    .sort()
    .map((k) => wikiFrames[k]),
}
