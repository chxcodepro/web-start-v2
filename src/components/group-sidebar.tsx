"use client";

import { useState, type MouseEvent } from "react";
import { Folder } from "lucide-react";

// 分组区块用了 content-visibility，没渲染过的先按估算高度占位，平滑滚动途中才陆续换成真实高度，目标位置会跟着偏移。
// 跳转前先让所有分组按真实高度排版，滚动结束后恢复；分组渲染过后会记住真实高度，恢复时不会再跳动
function jumpToGroup(event: MouseEvent<HTMLAnchorElement>, groupId: string) {
  // 中键、带修饰键的点击保持浏览器默认行为（比如在新标签页打开）
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(`group-${groupId}`);
  if (!target) return;
  event.preventDefault();
  const board = event.currentTarget.closest(".collection-board");
  board?.classList.add("is-jumping");
  window.history.replaceState(null, "", `#group-${groupId}`);
  window.requestAnimationFrame(() => {
    // behavior: auto 跟随页面的 scroll-behavior：平时平滑滚动，系统开启「减少动态效果」时直接跳转
    target.scrollIntoView({ block: "start", behavior: "auto" });
    // 焦点交给目标分组，键盘用户可以从这里继续；侧栏失去焦点后自动收起
    target.focus({ preventScroll: true });
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      window.removeEventListener("scrollend", finish);
      board?.classList.remove("is-jumping");
    };
    window.addEventListener("scrollend", finish, { once: true });
    // 已经在目标位置时不会触发 scrollend，也有浏览器不支持这个事件
    timer = window.setTimeout(finish, 1500);
  });
}

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
        onClick={(event) => jumpToGroup(event, group.id)}
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
