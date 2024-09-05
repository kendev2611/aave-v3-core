// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

contract MockSupra {
  // Data structure to hold the pair data
  struct priceFeed {
    uint256 round;
    uint256 decimals;
    uint256 time;
    uint256 price;
  }

  // Data structure to hold the derived/connverted data pairs.  This depends on your requirements.
  struct derivedData {
    int256 roundDifference;
    uint256 derivedPrice;
    uint256 decimals;
  }

  // Mapping to store price data for each pair ID
  mapping(uint256 => priceFeed) internal prices;

  // Constructor to initialize prices
  constructor(uint256[] memory pairIds, uint256[] memory initialPrices) {
    require(pairIds.length == initialPrices.length, 'Lengths do not match');

    // For loop to initialize prices
    for (uint256 i = 0; i < pairIds.length; i++) {
      prices[i] = priceFeed({
        round: 1,
        decimals: 6,
        time: block.timestamp * 1000,
        price: initialPrices[i]
      });
    }
  }

  function addPriceFeed(uint256 pairId, uint256 price) external {
    prices[pairId] = priceFeed({round: 1, decimals: 6, time: block.timestamp * 1000, price: price});
  }

  function updateTime(uint256 pairId, uint256 time) external {
    prices[pairId] = priceFeed({
      round: 1,
      decimals: 6,
      time: time * 1000,
      price: prices[pairId].price
    });
  }

  // Function to retrieve the data for a single data pair
  function getSvalue(uint256 _pairIndex) external view returns (priceFeed memory) {
    return prices[_pairIndex];
  }

  // Function to fetch the data for multiple data pairs
  function getSvalues(uint256[] memory _pairIndexes) external view returns (priceFeed[] memory) {
    priceFeed[] memory result = new priceFeed[](_pairIndexes.length);
    for (uint256 i = 0; i < _pairIndexes.length; i++) {
      result[i] = prices[_pairIndexes[i]];
    }
    return result;
  }

  // Function to convert and derive new data pairs using two pair IDs and a mathematical operator multiplication(*) or division(/).
  // ** Currently only available in testnets
  function getDerivedSvalue(
    uint256 pairId1,
    uint256 pairId2,
    uint256 operation
  ) external pure returns (derivedData memory) {
    // Dummy implementation, you can modify as per your requirements
    return derivedData(0, 0, 0);
  }

  // Function to check the latest Timestamp on which a data pair is updated. This will help you check the staleness of a data pair before performing an action.
  function getTimestamp(uint256 _tradingPair) external view returns (uint256) {
    return prices[_tradingPair].time;
  }
}
