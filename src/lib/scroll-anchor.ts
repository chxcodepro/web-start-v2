// 进入或退出管理时卡片会变高或变矮，书签分组末尾还会多出或去掉「点击添加书签」，视口上方的内容高度一变，正在看的分组就被推走。
// 浏览器自带的滚动锚定这时靠不住：它常选中视口顶部、上一个分组里正在变高的卡片当锚点，分组标题照样被推下去。
// 所以切换前自己记下正在看的分组标题或卡片在哪，切换后把它挪回原处。

// 自动修正滚动后发出，detail 是实际滚动的距离；顶栏据此把这次滚动排除在外，不会跟着收起或弹出
export const SCROLL_COMPENSATION_EVENT = "start-web:scroll-compensation";

export type ScrollAnchor = { node: HTMLElement; top: number };

// 准线取分组的 scroll-margin-top：点分组导航跳转后标题就停在这里，准线以上是顶栏（手机上还有分组条）盖住的区域。
// 锚点是准线所在分组里第一个下沿越过准线的标题或卡片；wholeSection 时直接用整个分组，适合卡片会换位置的情况（比如排序变了）
export function captureScrollAnchor(container: HTMLElement, wholeSection = false): ScrollAnchor | null {
  const sections = container.querySelectorAll<HTMLElement>(".editable-section");
  if (!sections.length) return null;
  const line = Number.parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0;
  for (const section of sections) {
    const box = section.getBoundingClientRect();
    if (box.bottom <= line) continue;
    if (!wholeSection) {
      // 只在这个分组里找：它和视口相交，已经正常渲染；视口外的分组用了 content-visibility，测量它们的内容会强制排版
      for (const node of section.querySelectorAll<HTMLElement>(".section-heading, .collection-card")) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom > line) return { node, top: rect.top };
      }
    }
    return { node: section, top: box.top };
  }
  return null;
}

// 在 DOM 更新之后、浏览器绘制之前调用（useLayoutEffect 里），中间那一帧不会被看到
export function restoreScrollAnchor(anchor: ScrollAnchor) {
  if (!anchor.node.isConnected) return;
  const shift = anchor.node.getBoundingClientRect().top - anchor.top;
  if (Math.abs(shift) < 0.5) return;
  const before = window.scrollY;
  // 页面平时是平滑滚动，这里必须立即到位，否则会看到页面先被推走再滑回来
  window.scrollTo({ top: before + shift, behavior: "instant" });
  // 到了页面底部时滚不满，按实际滚动的距离通知
  const applied = window.scrollY - before;
  if (applied) window.dispatchEvent(new CustomEvent<number>(SCROLL_COMPENSATION_EVENT, { detail: applied }));
}
