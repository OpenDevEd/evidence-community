import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';
 
export default createMiddleware(routing);
 
export const config = {
  matcher: ['/', `/(en-US|en-GB|de|sw|pt|ar|hi|fr|cn)/:path*`],
};
