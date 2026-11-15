// 登录页只等待会话校验，避免继承首页的书签骨架屏
export default function Loading() {
  return <main className="page-shell auth-page" aria-busy="true" />;
}
