"use client";

import { useState } from "react";
import { Folder } from "lucide-react";

export function GroupSidebar({ groups, canDropItems = false, onItemDrop }: {
  groups: { id: string; name: string }[];
  canDropItems?: boolean;
  onItemDrop?: (groupId: string) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return <aside className={`group-sidebar ${canDropItems ? "drag-active" : ""}`} aria-label="分组导航">
    <nav>
      {groups.map((group) => <a
        key={group.id}
        href={`#group-${group.id}`}
        title={canDropItems ? `移动到 ${group.name}` : group.name}
        className={dropTarget === group.id ? "drop-target" : ""}
        onDragEnter={(event) => { if (canDropItems) { event.preventDefault(); setDropTarget(group.id); } }}
        onDragOver={(event) => { if (canDropItems) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={(event) => { if (!canDropItems) return; event.preventDefault(); setDropTarget(null); onItemDrop?.(group.id); }}
      >
        <Folder size={14} aria-hidden="true" />
        <span>{group.name}</span>
      </a>)}
    </nav>
  </aside>;
}
