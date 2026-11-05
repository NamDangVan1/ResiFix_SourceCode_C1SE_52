import { PrismaClient } from '@prisma/client';

// Reuse one connection pool across API routes and middleware.
export const prisma = new PrismaClient();
