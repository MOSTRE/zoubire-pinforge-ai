import { runDueJobs, autoScheduleApproved } from '../services/scheduler';
import { publishPin } from '../services/publish';
import { logger } from '../logger';
import { prisma } from '../db';

async function main(): Promise<void> {
  const scheduled = await autoScheduleApproved();
  const ran = await runDueJobs((id) => publishPin(id, { force: true }));
  logger.info(`Worker tick: scheduled=${scheduled} published=${ran}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main();
}
