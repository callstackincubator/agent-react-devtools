---
'agent-react-devtools': minor
---

Component reads (`get tree`, `get component`, `find`, `count`, `errors`) now fail with a
structured `NO_APP_CONNECTED` response when no app is attached, instead of answering from an
empty component tree.

Previously `devtools errors` printed `No components with errors or warnings` with nothing
attached, so a check that was never performed was indistinguishable from a check that passed.
The refusal names how long ago the last app disconnected, replacing the empty-tree hint that
`get tree` used to attach to a successful response.
