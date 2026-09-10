---
'agent-react-devtools': minor
---

Tree observation commands (`get tree`, `get component`, `find`, `count`,
`errors`, `profile start`) now fail with a typed `no-app-attached` reason and a
non-zero exit code when no React app is attached, instead of reporting an empty
result that reads as a clean pass. When another React DevTools backend attaches
to the same app (React Native DevTools opening, another agent) and re-flushes the
tree under a fresh fiber-ID space, the daemon now replaces its frozen copy
instead of counting every component twice.
