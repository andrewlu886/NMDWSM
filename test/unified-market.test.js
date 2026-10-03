const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { searchProductsWithMeta } = require('../src/services/search');
const { scrape } = require('../src/scrapers/ruten');

test('merged search routes Ruten once and combines, deduplicates and filters fixed prices', async () => {
  const retailCalls = [], usedCalls = [];
  const item = (name,price,url,extra={}) => ({name,price,url,platform:'露天',...extra});
  const result = await searchProductsWithMeta({ keyword:'RTX 4060', platforms:'ruten,ptt', exclude:'筆電' }, {
    getMarketData: async (query,platforms) => {
      retailCalls.push(platforms);
      return {products:[item('RTX 4060 顯示卡','9000','https://www.ruten.com.tw/item/show?1'),item('RTX 4060 顯示卡','1500~10000','https://www.ruten.com.tw/item/show?2')],meta:{updatedAt:1}};
    },
    searchUsedProducts: async options => {
      usedCalls.push(options.platforms);
      return {data:[item('二手 RTX 4060 顯示卡',7200,'https://www.ptt.cc/bbs/HardwareSale/M.1.A.001.html',{source:'ptt',condition:'used'}),item('二手 RTX 4060 顯示卡',7200,'https://www.ptt.cc/bbs/HardwareSale/M.1.A.001.html',{source:'ptt',condition:'used'})],meta:{updatedAt:2,sourceStatus:{ptt:{name:'PTT',status:'ok',count:2}}}};
    }
  });
  assert.deepEqual(retailCalls,[['ruten']]);
  assert.deepEqual(usedCalls,[['ptt']]);
  assert.deepEqual(result.data.map(item=>Number(item.price)),[7200,9000]);
  assert.equal(result.meta.mode,'unified');
  assert.equal(result.meta.sourceStatus.ptt.count,1);
});

test('one source group failing does not remove successful listings', async () => {
  const result=await searchProductsWithMeta({keyword:'RTX 4060',platforms:'ruten,ptt'}, {
    getMarketData:async()=>{throw new Error('offline');},
    searchUsedProducts:async()=>({data:[{name:'二手 RTX 4060 顯示卡',price:7000,platform:'PTT',source:'ptt',condition:'used',url:'https://www.ptt.cc/bbs/HardwareSale/M.1.A.001.html'}],meta:{sourceStatus:{}}})
  });
  assert.equal(result.data.length,1);
  assert.equal(result.meta.sourceStatus.retail.status,'unavailable');
});

test('original Ruten crawler rejects price ranges before picking the minimum', async () => {
  const original=axios.get;
  try {
    axios.get=async url=>url.includes('/search/')?{data:{Rows:[{Id:1},{Id:2},{Id:3}]}}:{data:[
      {ProdId:1,ProdName:'RTX 4060 顯示卡',PriceRange:[1500,10000]},
      {ProdId:2,ProdName:'RTX 4060 顯示卡',PriceRange:[7200,7200]},
      {ProdId:3,ProdName:'RTX 4060 顯示卡',Price:'1500~10000'}
    ]};
    const results=await scrape('RTX 4060');
    assert.equal(results.length,1);
    assert.equal(results[0].url,'https://www.ruten.com.tw/item/show?2');
  } finally {axios.get=original;}
});