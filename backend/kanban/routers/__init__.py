"""HTTP layer: one module per resource, each exposing a `router` mounted under `/api`.

Routers are thin (Section 6.4): bind the path/query/body, resolve dependencies, call one service
function, return its result. No SQL, no business branching, no permission logic of their own.
"""
