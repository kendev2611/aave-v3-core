// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import {IPyth} from '../dependencies/pyth/IPyth.sol';
import {PythStructs} from '../dependencies/pyth/PythStructs.sol';
import {Errors} from '../protocol/libraries/helpers/Errors.sol';
import {IACLManager} from '../interfaces/IACLManager.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';
import {IAaveOracle} from '../interfaces/IAaveOracle.sol';

/**
 * @title AaveOracle
 * @author Aave
 * @notice Contract to get asset prices, manage price sources and update the fallback oracle
 * - Use of Pyth Price Feeds as first source of price
 * - If the returned price by a Pyth Price Feeds is <= 0, the call is forwarded to a fallback oracle
 * - Owned by the Aave governance
 */
contract AaveOracle is IAaveOracle {
  IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

  // Map of asset price feed IDs (asset => price feed ID)
  mapping(address => bytes32) private priceFeedIds;

  IPriceOracleGetter private _fallbackOracle;
  address public immutable override BASE_CURRENCY;
  uint256 public immutable override BASE_CURRENCY_UNIT;

  /**
   * @dev Only asset listing or pool admin can call functions marked by this modifier.
   */
  modifier onlyAssetListingOrPoolAdmins() {
    _onlyAssetListingOrPoolAdmins();
    _;
  }

  /**
   * @notice Constructor
   * @param provider The address of the new PoolAddressesProvider
   * @param assets The addresses of the assets
   * @param priceIds The price feed ID of each asset
   * @param fallbackOracle The address of the fallback oracle to use if the data of an
   *        aggregator is not consistent
   * @param baseCurrency The base currency used for the price quotes. If USD is used, base currency is 0x0
   * @param baseCurrencyUnit The unit of the base currency
   */
  constructor(
    IPoolAddressesProvider provider,
    address[] memory assets,
    bytes32[] memory priceIds,
    address fallbackOracle,
    address baseCurrency,
    uint256 baseCurrencyUnit
  ) {
    ADDRESSES_PROVIDER = provider;
    _setFallbackOracle(fallbackOracle);
    _setAssetsPriceFeedIds(assets, priceIds);
    BASE_CURRENCY = baseCurrency;
    BASE_CURRENCY_UNIT = baseCurrencyUnit;
    emit BaseCurrencySet(baseCurrency, baseCurrencyUnit);
  }

  /// @inheritdoc IAaveOracle
  function setAssetPriceFeedIds(
    address[] calldata assets,
    bytes32[] calldata priceIds
  ) external override onlyAssetListingOrPoolAdmins {
    _setAssetsPriceFeedIds(assets, priceIds);
  }

  /// @inheritdoc IAaveOracle
  function setFallbackOracle(
    address fallbackOracle
  ) external override onlyAssetListingOrPoolAdmins {
    _setFallbackOracle(fallbackOracle);
  }

  /**
   * @notice Internal function to set the price feed ID for each asset
   * @param assets The addresses of the assets
   * @param priceIds The price feed ID of each asset
   */
  function _setAssetsPriceFeedIds(address[] memory assets, bytes32[] memory priceIds) internal {
    require(assets.length == priceIds.length, Errors.INCONSISTENT_PARAMS_LENGTH);
    for (uint256 i = 0; i < assets.length; i++) {
      priceFeedIds[assets[i]] = priceIds[i];
      emit AssetPriceFeedIdUpdated(assets[i], priceIds[i]);
    }
  }

  /**
   * @notice Internal function to set the fallback oracle
   * @param fallbackOracle The address of the fallback oracle
   */
  function _setFallbackOracle(address fallbackOracle) internal {
    _fallbackOracle = IPriceOracleGetter(fallbackOracle);
    emit FallbackOracleUpdated(fallbackOracle);
  }

  /// @inheritdoc IPriceOracleGetter
  function getAssetPrice(address asset) public view override returns (uint256) {
    bytes32 priceFeedId = priceFeedIds[asset];

    if (asset == BASE_CURRENCY) {
      return BASE_CURRENCY_UNIT;
    } else if (priceFeedId == bytes32(0)) {
      return _fallbackOracle.getAssetPrice(asset);
    } else {
      PythStructs.Price memory priceStruct = IPyth(ADDRESSES_PROVIDER.getPyth()).getPrice(
        priceFeedId
      );
      if (priceStruct.price > 0) {
        return
          (uint256(uint64(priceStruct.price)) * BASE_CURRENCY_UNIT) /
          (10 ** uint256((uint32(priceStruct.expo * -1))));
      } else {
        return _fallbackOracle.getAssetPrice(asset);
      }
    }
  }

  /// @inheritdoc IAaveOracle
  function getAssetsPrices(
    address[] calldata assets
  ) external view override returns (uint256[] memory) {
    uint256[] memory prices = new uint256[](assets.length);
    for (uint256 i = 0; i < assets.length; i++) {
      prices[i] = getAssetPrice(assets[i]);
    }
    return prices;
  }

  /// @inheritdoc IAaveOracle
  function getPriceFeedIdOfAsset(address asset) external view override returns (bytes32) {
    return priceFeedIds[asset];
  }

  /// @inheritdoc IAaveOracle
  function getFallbackOracle() external view returns (address) {
    return address(_fallbackOracle);
  }

  function _onlyAssetListingOrPoolAdmins() internal view {
    IACLManager aclManager = IACLManager(ADDRESSES_PROVIDER.getACLManager());
    require(
      aclManager.isAssetListingAdmin(msg.sender) || aclManager.isPoolAdmin(msg.sender),
      Errors.CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN
    );
  }
}
