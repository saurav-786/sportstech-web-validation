import { signIn } from '@/auth';
import { BrandMark } from '@/components/brand-mark';

export default function SignInPage() {
  return (
    <div className="-m-5 grid min-h-[calc(100vh-62px)] place-items-center bg-gradient-to-br from-[#071441] via-[#171b67] to-[#2e176f] p-5">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-7 text-white shadow-2xl backdrop-blur-xl">
        <BrandMark/>
        <h1 className="mt-8 text-2xl font-extrabold tracking-tight">Quality Intelligence</h1>
        <p className="mt-2 text-sm leading-6 text-indigo-100/80">Sign in with your approved Google Workspace account to access Sportstech quality and revenue intelligence.</p>
        <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }); }}>
          <button className="mt-7 h-11 w-full rounded-lg bg-white font-bold text-indigo-800 transition hover:bg-indigo-50">Continue with Google</button>
        </form>
      </div>
    </div>
  );
}
