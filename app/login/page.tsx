export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <section className="panel">
      <h2>Officer sign in</h2>
      <form action="/login/session" method="post">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {params.error ? <p className="error">Those credentials were not accepted.</p> : null}
        <p>
          <button type="submit">Sign in</button>
        </p>
      </form>
    </section>
  )
}
