const githubApiBase = "https://api.github.com";
const defaultProxy = "https://gh-proxy.com/";
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type GithubDownloadFile = {
  id: string;
  name: string;
  size: number | null;
  contentType: string;
  kind: "asset" | "source";
  downloadUrl: string;
};

export type GithubDownloadVersion = {
  id: string;
  name: string;
  tagName: string;
  publishedAt: string | null;
  prerelease: boolean;
  files: GithubDownloadFile[];
};

export type GithubDownloadCatalog = {
  repository: string;
  defaultBranch: string;
  hasReleases: boolean;
  versions: GithubDownloadVersion[];
};

type GithubRepositoryResponse = { default_branch: string };
type GithubReleaseResponse = {
  id: number;
  name: string | null;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: Array<{
    id: number;
    name: string;
    size: number;
    content_type: string;
    browser_download_url: string;
  }>;
};

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

function acceleratedUrl(originalUrl: string) {
  const original = new URL(originalUrl);
  if (original.protocol !== "https:" || !["github.com", "api.github.com"].includes(original.hostname)) {
    throw new Error("GitHub 下载地址无效");
  }

  const configured = process.env.GITHUB_DOWNLOAD_PROXY?.trim() || defaultProxy;
  if (configured.toLowerCase() === "direct") return original.toString();
  const proxy = new URL(configured);
  if (proxy.protocol !== "https:" || proxy.username || proxy.password || proxy.search || proxy.hash) {
    throw new Error("GITHUB_DOWNLOAD_PROXY 配置无效");
  }
  const prefix = proxy.toString().endsWith("/") ? proxy.toString() : `${proxy.toString()}/`;
  return `${prefix}${original.toString()}`;
}

function sourceFiles(fullName: string, ref: string): GithubDownloadFile[] {
  const base = `https://api.github.com/repos/${fullName}`;
  return [
    { id: `source-zip-${ref}`, name: "源代码 (ZIP)", size: null, contentType: "application/zip", kind: "source", downloadUrl: acceleratedUrl(`${base}/zipball/${encodeURIComponent(ref)}`) },
    { id: `source-tar-${ref}`, name: "源代码 (TAR.GZ)", size: null, contentType: "application/gzip", kind: "source", downloadUrl: acceleratedUrl(`${base}/tarball/${encodeURIComponent(ref)}`) }
  ];
}

async function githubJson<T>(path: string): Promise<T> {
  const response = await fetch(`${githubApiBase}${path}`, { headers: githubHeaders, next: { revalidate: 300 } });
  if (!response.ok) {
    if (response.status === 404) throw new Error("GitHub 仓库不存在或无法访问");
    throw new Error(`GitHub Release 查询失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export async function getGithubDownloadCatalog(fullName: string): Promise<GithubDownloadCatalog> {
  if (!repositoryPattern.test(fullName)) throw new Error("仓库名称无效");

  const encodedName = fullName.split("/").map(encodeURIComponent).join("/");
  const [repository, releaseRows] = await Promise.all([
    githubJson<GithubRepositoryResponse>(`/repos/${encodedName}`),
    githubJson<GithubReleaseResponse[]>(`/repos/${encodedName}/releases?per_page=30&page=1`)
  ]);
  const releases = releaseRows.filter((release) => !release.draft);
  const versions: GithubDownloadVersion[] = releases.map((release) => ({
    id: String(release.id),
    name: release.name?.trim() || release.tag_name,
    tagName: release.tag_name,
    publishedAt: release.published_at,
    prerelease: release.prerelease,
    files: [
      ...release.assets.map((asset) => ({
          id: `asset-${asset.id}`,
          name: asset.name,
          size: asset.size,
          contentType: asset.content_type,
          kind: "asset" as const,
          downloadUrl: acceleratedUrl(asset.browser_download_url)
        })),
      ...sourceFiles(fullName, release.tag_name)
    ]
  }));

  if (!versions.length) {
    const defaultBranch = repository.default_branch || "main";
    versions.push({
      id: `branch-${defaultBranch}`,
      name: `${defaultBranch} 默认分支`,
      tagName: defaultBranch,
      publishedAt: null,
      prerelease: false,
      files: sourceFiles(fullName, defaultBranch)
    });
  }

  return {
    repository: fullName,
    defaultBranch: repository.default_branch || "main",
    hasReleases: releases.length > 0,
    versions
  };
}
