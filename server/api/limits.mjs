export const FREE_SHARE_LINKS = 1;
export const PRO_SHARE_LINKS = 5;
export const FREE_SHARE_DAYS = 7;
export const PRO_SHARE_DAYS = 30;

export function shareLimits(pro) {
  return pro
    ? { links: PRO_SHARE_LINKS, days: PRO_SHARE_DAYS }
    : { links: FREE_SHARE_LINKS, days: FREE_SHARE_DAYS };
}
