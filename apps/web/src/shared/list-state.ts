import { maxPage } from '@myteam/contracts';
export function readPage(value: string | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= maxPage ? number : 1;
}
