// These suites exercise matching/routing with synthetic products. Stock checks have
// dedicated lifecycle tests and must not perform network requests for fake URLs.
const search = require('../../src/services/search');
function dependencies(deps) {
  return { lifecycle: { retained: () => [], trackQuery() {}, filter: async products => ({ products, hidden: [], failures: {} }) }, ...deps };
}
module.exports = { ...search,
  searchProducts: (options, deps) => search.searchProducts(options, dependencies(deps)),
  searchProductsWithMeta: (options, deps) => search.searchProductsWithMeta(options, dependencies(deps)) };
