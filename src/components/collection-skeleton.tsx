type SkeletonKind = "bookmark" | "github";

// 复用真实页面的网格类名，数据到达时布局基本不跳动
const placeholderGroups: Record<SkeletonKind, number[]> = { bookmark: [14, 7, 7], github: [10, 5] };

export function SearchSkeleton() {
  return <section className="hero" aria-hidden="true">
    <div className="search-wrap">
      <div className="search-box glass skeleton-surface">
        <span className="engine-picker"><span className="skeleton-block skeleton-engine" /></span>
        <span className="skeleton-placeholder skeleton-search-text">搜索或输入网址</span>
      </div>
    </div>
  </section>;
}

export function CollectionSkeleton({ kind, notice }: { kind: SkeletonKind; notice?: string }) {
  const cardClass = kind === "bookmark" ? "bookmark-card" : "star-card";
  return <div className="collection-skeleton" role="status" aria-busy="true">
    <span className="sr-only">{kind === "bookmark" ? "正在加载书签" : "正在加载 GitHub Star"}</span>
    {kind === "github" && <div className="star-toolbar" aria-hidden="true">
      <span className="star-search glass skeleton-surface"><span className="skeleton-placeholder">搜索 GitHub Star</span></span>
      <span className="star-sort glass skeleton-surface"><span className="skeleton-placeholder">自定义排序</span></span>
    </div>}
    {notice && <p className="skeleton-notice">{notice}</p>}
    <div className="group-content" aria-hidden="true">
      {placeholderGroups[kind].map((count, groupIndex) => <section className="section" key={groupIndex}>
        <div className="section-heading"><span className="skeleton-block skeleton-heading" /></div>
        <div className={kind === "bookmark" ? "bookmark-grid" : "star-grid"}>
          {Array.from({ length: count }, (_, index) => <div className={`${cardClass} skeleton-card`} key={index}>
            <span className="skeleton-block skeleton-icon" />
            <span className="skeleton-copy">
              <span className="skeleton-block skeleton-line" />
              {kind === "github" && <>
                <span className="skeleton-block skeleton-line wide" />
                <span className="skeleton-block skeleton-line short" />
              </>}
            </span>
          </div>)}
        </div>
      </section>)}
    </div>
  </div>;
}
