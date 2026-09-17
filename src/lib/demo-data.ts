import type { BookmarkGroup, GithubGroup } from "@/lib/types";

export const demoBookmarkGroups: BookmarkGroup[] = [
  {
    id: "demo-daily",
    kind: "bookmark",
    name: "日常使用",
    sortOrder: 0,
    isPublic: true,
    items: [
      { id: "demo-github", groupId: "demo-daily", title: "GitHub", url: "https://github.com", description: "代码、Issue 与项目协作", faviconUrl: null, tags: ["开发"], sortOrder: 0, isPublic: true },
      { id: "demo-vercel", groupId: "demo-daily", title: "Vercel", url: "https://vercel.com", description: "项目部署与运行状态", faviconUrl: null, tags: ["部署"], sortOrder: 1, isPublic: true },
      { id: "demo-notion", groupId: "demo-daily", title: "Notion", url: "https://www.notion.so", description: "笔记与资料整理", faviconUrl: null, tags: ["效率"], sortOrder: 2, isPublic: true }
    ]
  },
  {
    id: "demo-reading",
    kind: "bookmark",
    name: "阅读与灵感",
    sortOrder: 1,
    isPublic: true,
    items: [
      { id: "demo-mdn", groupId: "demo-reading", title: "MDN Web Docs", url: "https://developer.mozilla.org", description: "可靠的 Web 技术参考", faviconUrl: null, tags: ["文档"], sortOrder: 0, isPublic: true },
      { id: "demo-smashing", groupId: "demo-reading", title: "Smashing Magazine", url: "https://www.smashingmagazine.com", description: "前端与设计文章", faviconUrl: null, tags: ["设计"], sortOrder: 1, isPublic: true }
    ]
  }
];

export const demoGithubGroups: GithubGroup[] = [
  {
    id: "demo-star-tools",
    kind: "github",
    name: "开发工具",
    sortOrder: 0,
    isPublic: true,
    items: [
      { id: "demo-next", githubRepoId: 70107786, groupId: "demo-star-tools", fullName: "vercel/next.js", displayName: null, htmlUrl: "https://github.com/vercel/next.js", description: "The React Framework for the Web", language: "JavaScript", starsCount: 136000, ownerAvatarUrl: "https://github.com/vercel.png", tags: ["框架"], note: null, sortOrder: 0, isPublic: true, isActive: true, starredAt: null, syncedAt: "2026-09-12T08:00:00Z", repoUpdatedAt: "2026-09-12T08:00:00Z" },
      { id: "demo-tailwind", githubRepoId: 106017343, groupId: "demo-star-tools", fullName: "tailwindlabs/tailwindcss", displayName: "Tailwind CSS", htmlUrl: "https://github.com/tailwindlabs/tailwindcss", description: "A utility-first CSS framework", language: "TypeScript", starsCount: 90000, ownerAvatarUrl: "https://github.com/tailwindlabs.png", tags: ["样式"], note: "快速搭建界面样式", sortOrder: 1, isPublic: true, isActive: true, starredAt: null, syncedAt: "2026-09-10T08:00:00Z", repoUpdatedAt: "2026-09-10T08:00:00Z" }
    ]
  },
  {
    id: "demo-star-ungrouped",
    kind: "github",
    name: "未分组",
    sortOrder: 99,
    isPublic: true,
    items: [
      { id: "demo-lucide", githubRepoId: 454543673, groupId: "demo-star-ungrouped", fullName: "lucide-icons/lucide", displayName: null, htmlUrl: "https://github.com/lucide-icons/lucide", description: "Beautiful & consistent icon toolkit", language: "TypeScript", starsCount: 21000, ownerAvatarUrl: "https://github.com/lucide-icons.png", tags: [], note: null, sortOrder: 0, isPublic: true, isActive: true, starredAt: null, syncedAt: "2026-09-11T08:00:00Z", repoUpdatedAt: "2026-09-11T08:00:00Z" }
    ]
  }
];
