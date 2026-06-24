export const formatResolvedAddress = (result) => {
  if (!result) {
    return '';
  }

  const primary = [result.name, result.street].filter(Boolean).join(', ');
  const secondary = [
    result.district,
    result.city,
    result.subregion,
    result.region,
    result.postalCode,
    result.country,
  ].filter(Boolean);

  return [primary, secondary.join(', ')].filter(Boolean).join(', ');
};
