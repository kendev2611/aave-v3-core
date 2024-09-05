// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PythStructs} from '../../../dependencies/pyth/PythStructs.sol';

contract MockPyth {
  mapping(bytes32 => PythStructs.Price) private prices;

  event PriceUpdated(
    int64 indexed current,
    uint64 indexed conf,
    int32 indexed expo,
    uint updatedAt
  );

  constructor(bytes32[] memory ids, int64[] memory initialPrices) {
    // for loop to initialize prices
    for (uint i = 0; i < ids.length; i++) {
      prices[ids[i]] = PythStructs.Price(initialPrices[i], 1, -8, block.timestamp);
      emit PriceUpdated(initialPrices[i], 1, 0, block.timestamp);
    }
  }

  function getPrice(bytes32 id) external view returns (PythStructs.Price memory price) {
    return prices[id];
  }

  function getEmaPrice(bytes32 id) external view returns (PythStructs.Price memory price) {
    return prices[id];
  }

  function setPrice(bytes32 id, int64 newPrice) external {
    PythStructs.Price storage price = prices[id];

    price.price = newPrice;
  }
}
