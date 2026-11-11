/** Copy dictionaries for the phone pairing surface: the pairing screen and the session-required screen. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  title: 'Connect phone',
  codeLabel: 'Pairing code',
  waiting: 'Confirm this phone on the computer to finish pairing.',
  denied: 'The computer denied this pairing request.',
  expired: 'This code is no longer valid. Create a new one on the computer.',
  locked: 'Too many attempts from this phone. Wait a minute, then try again.',
  authTitle: 'Signed out',
  authBody: 'This device\'s credential expired or was revoked. On the computer, open Settings → General → Connect phone, create a pairing code, and open its link on this device.',
  authReload: 'Reload',
} as const

/** Translation keys owned by the pairing screen. */
export type PairScreenKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<PairScreenKey, string> = {
  title: '连接手机',
  codeLabel: '配对码',
  waiting: '请在电脑端确认这台手机以完成配对。',
  denied: '电脑端拒绝了这次配对请求。',
  expired: '该配对码已失效，请在电脑端重新生成。',
  locked: '这台手机的尝试次数过多。请等待一分钟后重试。',
  authTitle: '登录已失效',
  authBody: '本设备的凭证已过期或被吊销。请在电脑端打开 设置 → 通用设置 → 连接手机，生成配对码后在本设备上打开该链接。',
  authReload: '重新加载',
}

/** Japanese dictionary. */
export const ja = {
  title: 'スマートフォンを接続',
  codeLabel: 'ペアリングコード',
  waiting: 'コンピューターでこのスマートフォンを承認すると、ペアリングが完了します。',
  denied: 'コンピューターがペアリングのリクエストを拒否しました。',
  expired: 'このコードは無効になりました。コンピューターで新しいコードを作成してください。',
  locked: 'このスマートフォンからの試行回数が上限に達しました。1 分待ってからやり直してください。',
  authTitle: 'サインアウトしました',
  authBody: 'このデバイスの認証情報は期限切れか、取り消されています。コンピューターで「設定 → 一般 → スマートフォンを接続」を開き、ペアリングコードを作成して、このデバイスでリンクを開いてください。',
  authReload: '再読み込み',
} satisfies Record<PairScreenKey, string>

/** Spanish dictionary. */
export const es = {
  title: 'Conectar teléfono',
  codeLabel: 'Código de vinculación',
  waiting: 'Confirma este teléfono en el ordenador para terminar la vinculación.',
  denied: 'El ordenador rechazó la solicitud de vinculación.',
  expired: 'Este código ya no es válido. Crea uno nuevo en el ordenador.',
  locked: 'Demasiados intentos desde este teléfono. Espera un minuto y vuelve a intentarlo.',
  authTitle: 'Sesión cerrada',
  authBody: 'La credencial de este dispositivo ha caducado o se ha revocado. En el ordenador, abre Configuración → General → Conectar teléfono, crea un código de vinculación y abre su enlace en este dispositivo.',
  authReload: 'Recargar',
} satisfies Record<PairScreenKey, string>

/** French dictionary. */
export const fr = {
  title: 'Connecter un téléphone',
  codeLabel: 'Code d’association',
  waiting: 'Confirmez ce téléphone sur l’ordinateur pour terminer l’association.',
  denied: 'L’ordinateur a refusé la demande d’association.',
  expired: 'Ce code n’est plus valide. Créez-en un nouveau sur l’ordinateur.',
  locked: 'Trop de tentatives depuis ce téléphone. Attendez une minute, puis réessayez.',
  authTitle: 'Déconnecté',
  authBody: 'L’identifiant de cet appareil a expiré ou a été révoqué. Sur l’ordinateur, ouvrez Paramètres → Général → Connecter un téléphone, créez un code d’association et ouvrez son lien sur cet appareil.',
  authReload: 'Recharger',
} satisfies Record<PairScreenKey, string>

/** German dictionary. */
export const de = {
  title: 'Telefon verbinden',
  codeLabel: 'Kopplungscode',
  waiting: 'Bestätigen Sie dieses Telefon am Computer, um die Kopplung abzuschließen.',
  denied: 'Der Computer hat diese Kopplungsanfrage abgelehnt.',
  expired: 'Dieser Code ist nicht mehr gültig. Erstellen Sie am Computer einen neuen.',
  locked: 'Zu viele Versuche von diesem Telefon. Warten Sie eine Minute und versuchen Sie es erneut.',
  authTitle: 'Abgemeldet',
  authBody: 'Die Zugangsdaten dieses Geräts sind abgelaufen oder wurden widerrufen. Öffnen Sie am Computer Einstellungen → Allgemein → Telefon verbinden, erstellen Sie einen Kopplungscode und öffnen Sie seinen Link auf diesem Gerät.',
  authReload: 'Neu laden',
} satisfies Record<PairScreenKey, string>

/** Russian dictionary. */
export const ru = {
  title: 'Подключить телефон',
  codeLabel: 'Код сопряжения',
  waiting: 'Подтвердите этот телефон на компьютере, чтобы завершить сопряжение.',
  denied: 'Компьютер отклонил запрос на сопряжение.',
  expired: 'Этот код больше не действителен. Создайте новый на компьютере.',
  locked: 'Слишком много попыток с этого телефона. Подождите минуту и повторите попытку.',
  authTitle: 'Вы вышли из системы',
  authBody: 'Срок действия учётных данных этого устройства истёк или они были отозваны. На компьютере откройте «Настройки → Общие → Подключить телефон», создайте код сопряжения и откройте его ссылку на этом устройстве.',
  authReload: 'Перезагрузить',
} satisfies Record<PairScreenKey, string>

/** Portuguese dictionary. */
export const pt = {
  title: 'Ligar telemóvel',
  codeLabel: 'Código de emparelhamento',
  waiting: 'Confirme este telemóvel no computador para concluir o emparelhamento.',
  denied: 'O computador recusou o pedido de emparelhamento.',
  expired: 'Este código já não é válido. Crie um novo no computador.',
  locked: 'Demasiadas tentativas neste telemóvel. Aguarde um minuto e tente novamente.',
  authTitle: 'Sessão terminada',
  authBody: 'A credencial deste dispositivo expirou ou foi revogada. No computador, abra Definições → Geral → Ligar telemóvel, crie um código de emparelhamento e abra a respetiva ligação neste dispositivo.',
  authReload: 'Recarregar',
} satisfies Record<PairScreenKey, string>
