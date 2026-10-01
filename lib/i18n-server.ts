import 'server-only'

import { cookies } from 'next/headers'
import { normalizeUiLanguage, UI_LANGUAGE_COOKIE, type UiLanguage } from '@/lib/i18n'

export async function getServerUiLanguage(): Promise<UiLanguage> {
  return normalizeUiLanguage((await cookies()).get(UI_LANGUAGE_COOKIE)?.value)
}
