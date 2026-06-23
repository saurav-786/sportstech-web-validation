import type { DefaultSession } from 'next-auth';
import type { DashboardRole } from '@/auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      role: DashboardRole;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: DashboardRole;
  }
}
