function parseAddress(address = "") {
  const match = address.match(
    /^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?),\s*([^,]+)$/
  );

  if (!match) {
    return {
      Street: "",
      City: "",
      State: "",
      "Zip Code": "",
      Country: "USA",
    };
  }

  const [, street, city, state, zipCode, country] = match;

  return {
    Street: street.trim(),
    City: city.trim(),
    State: state.trim(),
    "Zip Code": zipCode.trim(),
    Country: country.trim() || "USA",
  };
}