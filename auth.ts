import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export type DashboardRole = 'admin' | 'qa' | 'product' | 'support' | 'sales' | 'marketing';

function configuredRole(email?: string | null): DashboardRole {
  if (!email) return 'sales';
  const roleMap = (process.env.DASHBOARD_ROLE_MAP ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, DashboardRole>>((map, entry) => {
      const [address, role] = entry.split(':');
      if (address && role) map[address.toLowerCase()] = role as DashboardRole;
      return map;
    }, {});
  if (roleMap[email.toLowerCase()]) return roleMap[email.toLowerCase()];
  const admins = (process.env.DASHBOARD_ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.toLowerCase()) ? 'admin' : 'sales';
}

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET
    ?? (process.env.DASHBOARD_AUTH_REQUIRED === 'true'
      ? undefined
      : 'local-development-insecure-secret-change-before-production'),
  providers: googleConfigured
    ? [Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      })]
    : [],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token }) {
      token.role = configuredRole(token.email);
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = (token.role as DashboardRole) ?? 'sales';
      return session;
    },
    authorized({ auth: session }) {
      if (process.env.DASHBOARD_AUTH_REQUIRED !== 'true') return true;
      return Boolean(session?.user);
    },
  },
  pages: {
    signIn: '/signin',
  },
});
