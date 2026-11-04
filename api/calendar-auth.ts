import { authorizeCalendarRequest } from '../server/calendar-authorization.js';
import { calendarDeploymentAllowed, calendarUnavailable } from '../server/calendar-deployment.js';
export default { fetch(request: Request) { return calendarDeploymentAllowed() ? authorizeCalendarRequest(request) : calendarUnavailable(); } };
