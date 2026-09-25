/**
 * Intentionally invalid. `no-restricted-syntax` must reject this file, which is
 * what the lint-fixtures test asserts. The shapes below are the ones real code
 * uses, including the qualified `prisma.booking.update` handle and the nested
 * `data` object, because a ban that only catches one of them can be sidestepped.
 * Never import or build this module.
 */
declare const prisma: { booking: { update: (args: unknown) => Promise<void> } };

export const bareStatusWrite = async (): Promise<void> => {
  await update({ status: 'VERIFIED' });
};

export const prismaStatusWrite = async (): Promise<void> => {
  await prisma.booking.update({ where: { id: '1' }, data: { status: 'VERIFIED' } });
};

export const bareNestedStatusWrite = async (): Promise<void> => {
  await update({ where: { id: '1' }, data: { status: 'CANCELLED_CUSTOMER' } });
};
