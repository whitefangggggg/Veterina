export default function GoogleAuthButton({ busy, onClick }) {
  return <button type="button" className="button auth-google" onClick={onClick}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.17v5h6.61c3.87-3.56 6.08-8.81 6.08-14.67Z" />
      <path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.51-4.96l-6.61-5c-1.83 1.23-4.17 1.97-6.9 1.97-5.31 0-9.82-3.58-11.43-8.4H5.75v5.15A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.57 27.61A12 12 0 0 1 12 24c0-1.25.2-2.46.57-3.61v-5.15H5.75A20 20 0 0 0 4 24c0 3.23.77 6.29 2.14 9l6.43-5.39Z" />
      <path fill="#EA4335" d="M24 12c3 0 5.68 1.03 7.8 3.05l5.85-5.85A19.6 19.6 0 0 0 24 4 20 20 0 0 0 5.75 15.24l6.82 5.15C14.18 15.58 18.69 12 24 12Z" />
    </svg>
    {busy ? 'Connecting to Google...' : 'Continue with Google'}
  </button>
}
