import { Cron } from 'croner';

export class AutomationScheduleError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'AutomationScheduleError';
  }
}

export function validateTimezone(value: string): string {
  const timezone = value.trim();
  if (!timezone || timezone.length > 64) throw new AutomationScheduleError('invalid_automation_timezone', 'Timezone non valida');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new AutomationScheduleError('invalid_automation_timezone', 'Timezone non valida');
  }
  return timezone;
}

export function validateCron(expression: string, timezone = 'UTC'): string {
  const cron = expression.trim();
  if (!cron || cron.length > 100) throw new AutomationScheduleError('invalid_automation_cron', 'Espressione cron non valida');
  if (cron.split(/\s+/).length !== 5) {
    throw new AutomationScheduleError('invalid_automation_cron', 'Usa un’espressione cron a 5 campi: minuto ora giorno mese giorno-settimana');
  }
  try {
    const schedule = new Cron(cron, { timezone: validateTimezone(timezone), paused: true });
    if (!schedule.nextRun()) throw new Error('no next run');
  } catch (error) {
    if (error instanceof AutomationScheduleError) throw error;
    throw new AutomationScheduleError('invalid_automation_cron', 'Espressione cron non valida');
  }
  return cron;
}

export function nextRunAt(expression: string, timezone: string, from = Date.now()): number | undefined {
  try {
    const schedule = new Cron(validateCron(expression, timezone), { timezone: validateTimezone(timezone), paused: true });
    return schedule.nextRun(new Date(from))?.getTime();
  } catch {
    return undefined;
  }
}
