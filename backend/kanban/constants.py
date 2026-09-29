"""Palettes and the closed list of activity types.

This module is the single source of truth for every value in this file (CLAUDE.md section 3):
`models.py` builds its `CHECK (... IN ...)` constraints from these keys, `routers/meta.py` serves
them to the frontend through `GET /api/meta`, and no second copy may exist anywhere else.
Hexes come from Section 2.9 of docs/PLANNING.md, activity types from Section 3.8.
"""

from typing import Final

#: Label palette (Section 2.9.2). Keyed by the value stored in `labels.color`; the `none` key is
#: the "no colour" label, identical in every tone.
LABEL_COLORS: Final[dict[str, dict[str, str]]] = {
    "green": {
        "subtle": "#BAF3DB",
        "normal": "#4BCE97",
        "bold": "#1F845A",
        "text": "#164B35",
        "text_bold": "#FFFFFF",
    },
    "yellow": {
        "subtle": "#F8E6A0",
        "normal": "#F5CD47",
        "bold": "#946F00",
        "text": "#533F04",
        "text_bold": "#FFFFFF",
    },
    "orange": {
        "subtle": "#FEDEC8",
        "normal": "#FEA362",
        "bold": "#C25100",
        "text": "#702E00",
        "text_bold": "#FFFFFF",
    },
    "red": {
        "subtle": "#FFD5D2",
        "normal": "#F87168",
        "bold": "#C9372C",
        "text": "#601E16",
        "text_bold": "#FFFFFF",
    },
    "purple": {
        "subtle": "#DFD8FD",
        "normal": "#9F8FEF",
        "bold": "#6E5DC6",
        "text": "#352C63",
        "text_bold": "#FFFFFF",
    },
    "blue": {
        "subtle": "#CCE0FF",
        "normal": "#579DFF",
        "bold": "#0C66E4",
        "text": "#09326C",
        "text_bold": "#FFFFFF",
    },
    "sky": {
        "subtle": "#C6EDFB",
        "normal": "#6CC3E0",
        "bold": "#206A83",
        "text": "#164555",
        "text_bold": "#FFFFFF",
    },
    "lime": {
        "subtle": "#D3F1A7",
        "normal": "#94C748",
        "bold": "#5B7F24",
        "text": "#37471F",
        "text_bold": "#FFFFFF",
    },
    "pink": {
        "subtle": "#FDD0EC",
        "normal": "#E774BB",
        "bold": "#AE4787",
        "text": "#50253F",
        "text_bold": "#FFFFFF",
    },
    "black": {
        "subtle": "#DCDFE4",
        "normal": "#8590A2",
        "bold": "#626F86",
        "text": "#091E42",
        "text_bold": "#FFFFFF",
    },
    "none": {
        "subtle": "#091E420F",
        "normal": "#091E420F",
        "bold": "#091E420F",
        "text": "#172B4D",
        "text_bold": "#172B4D",
    },
}

#: Card cover colours (Section 2.9.2): the `normal` label tone, with `gray` replacing `black`.
COVER_COLORS: Final[dict[str, str]] = {
    "green": "#4BCE97",
    "yellow": "#F5CD47",
    "orange": "#FEA362",
    "red": "#F87168",
    "purple": "#9F8FEF",
    "blue": "#579DFF",
    "sky": "#6CC3E0",
    "lime": "#94C748",
    "pink": "#E774BB",
    "gray": "#8590A2",
}

#: List header/background colours (Section 2.4): the `subtle` label tone, `gray` for `black`.
LIST_COLORS: Final[dict[str, str]] = {
    "green": "#BAF3DB",
    "yellow": "#F8E6A0",
    "orange": "#FEDEC8",
    "red": "#FFD5D2",
    "purple": "#DFD8FD",
    "blue": "#CCE0FF",
    "sky": "#C6EDFB",
    "lime": "#D3F1A7",
    "pink": "#FDD0EC",
    "gray": "#DCDFE4",
}

#: Solid board backgrounds (Section 2.9.3), stored raw in `boards.background_value`.
BOARD_COLORS: Final[dict[str, str]] = {
    "blue": "#0079BF",
    "orange": "#D29034",
    "green": "#519839",
    "red": "#B04632",
    "purple": "#89609E",
    "pink": "#CD5A91",
    "lime": "#4BBF6B",
    "sky": "#00AECC",
    "grey": "#838C91",
}

#: The default `boards.background_value` for a freshly created board.
DEFAULT_BOARD_COLOR: Final[str] = BOARD_COLORS["blue"]

#: Gradient board backgrounds (Section 2.9.3); the preset key is stored in `background_value`.
BOARD_GRADIENTS: Final[dict[str, str]] = {
    "gradient-ocean": "linear-gradient(135deg, #0079BF 0%, #5067C5 100%)",
    "gradient-sunset": "linear-gradient(135deg, #D29034 0%, #B04632 100%)",
    "gradient-forest": "linear-gradient(135deg, #519839 0%, #1F845A 100%)",
    "gradient-dusk": "linear-gradient(135deg, #89609E 0%, #CD5A91 100%)",
}

#: The closed list of `activities.type` values (Section 3.8). `activity.record()` validates
#: against it; a type that is not here is a programming error.
ACTIVITY_TYPES: Final[frozenset[str]] = frozenset(
    {
        "board.created",
        "board.renamed",
        "board.description_changed",
        "board.background_changed",
        "board.closed",
        "board.reopened",
        "list.created",
        "list.renamed",
        "list.moved",
        "list.moved_out",
        "list.moved_in",
        "list.copied",
        "list.archived",
        "list.unarchived",
        "list.color_changed",
        "card.created",
        "card.copied",
        "card.renamed",
        "card.description_changed",
        "card.moved",
        "card.reordered",
        "card.moved_out",
        "card.moved_in",
        "card.archived",
        "card.unarchived",
        "card.deleted",
        "card.due_set",
        "card.due_removed",
        "card.due_completed",
        "card.due_incompleted",
        "card.cover_changed",
        "card.cover_removed",
        "card.template_set",
        "card.template_unset",
        "card.label_added",
        "card.label_removed",
        "label.created",
        "label.updated",
        "label.deleted",
        "checklist.added",
        "checklist.renamed",
        "checklist.deleted",
        "checklist.moved",
        "checklist.item_added",
        "checklist.item_renamed",
        "checklist.item_deleted",
        "checklist.item_checked",
        "checklist.item_unchecked",
        "checklist.item_due_set",
        "checklist.item_due_removed",
        "checklist.item_converted",
        "checklist.item_moved",
        "attachment.added",
        "attachment.renamed",
        "attachment.deleted",
    }
)
