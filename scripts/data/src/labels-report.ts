/** Per-attribute precision / coverage against the hand-labelled sets.  npm run labels -w @app/data */
import { evaluate, formatReport } from './labels-eval';

const stats = evaluate();
console.log(formatReport(stats));
