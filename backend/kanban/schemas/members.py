"""The two response shapes of the card member and watch routes (Section 4.5).

Neither is a `Mutated[T]`, and both are new: `PublicUserOut` and `MemberOut` describe a *user*,
while these two answer with the card's assignee list and the caller's own watch flag, which is what
`MembersPopover`, the Join button and the Watch button patch into their caches (Section 2.6.5).
"""

from pydantic import BaseModel


class CardMembersOut(BaseModel):
    """`PUT` / `DELETE /api/cards/{card_id}/members/{user_id}` (Section 4.5).

    The card's whole assignee list comes back rather than the one row that changed, in the same
    `user_id` order `CardSummary.member_ids` carries, so the client patches one array - exactly as
    `CardLabelsOut` does for the label toggles.
    """

    member_ids: list[int]
    board_version: int


class WatchOut(BaseModel):
    """`PUT` / `DELETE /api/cards/{card_id}/watch` (Sections 4.5 and 4.1).

    Watching is per-user state: there is no `board_version` to report because the write bumps no
    version, and it mirrors the `StarOut` of the per-user board star.
    """

    is_watching: bool
