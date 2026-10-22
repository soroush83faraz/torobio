import type { VisitTime } from '../api/types';

/** A day/time is "set" unless it is the default «امروز · هر زمان». */
export const isVisitActive = (visit: VisitTime): boolean => !(visit.day === 'today' && visit.window === 'any');
