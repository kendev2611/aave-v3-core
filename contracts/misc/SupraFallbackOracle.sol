// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';
import {IFallbackOracle} from '../interfaces/IFallbackOracle.sol';
import {IACLManager} from '../interfaces/IACLManager.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {Errors} from '../protocol/libraries/helpers/Errors.sol';
import {ISupraSValueFeed} from '../interfaces/ISupraSValueFeed.sol';
import {IAaveOracle} from '../interfaces/IAaveOracle.sol';
import {Errors} from '../protocol/libraries/helpers/Errors.sol';

contract SupraFallbackOracle is IFallbackOracle {
  IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
  IAaveOracle public immutable MAIN_ORACLE;

  // Map of asset pair index (asset => pair index (USDT))
  mapping(address => uint256) public assetsIndexes;
  // Map of existing assets in the oracle (asset => exist)
  mapping(address => bool) public existAssets;
  uint256 private _stalenessThreshold;

  IPriceOracleGetter private _fallbackOracle;
  ISupraSValueFeed private _sValueFeed;
  address public immutable override BASE_CURRENCY;
  uint256 public immutable override BASE_CURRENCY_UNIT;

  event StalenessThresholdSet(uint256 stalenessThreshold);
  event PairIndexUpdated(address asset, uint256 pairIndex);

  /**
   * @dev Only asset listing or pool admin can call functions marked by this modifier.
   */
  modifier onlyAssetListingOrPoolAdmins() {
    _onlyAssetListingOrPoolAdmins();
    _;
  }

  event SValueFeedUpdated(address sValueFeed);

  /**
   * @param provider The address of the PoolAddressesProvider
   * @param assets The addresses of the assets to set initial sources
   * @param fallbackOracle The address of the fallback oracle to use if the data of an
   *        aggregator is not consistent
   * @param mainOracle The main oracle from which the base currency is retrieved
   * @param pairIndexes The corresponding pair indexes for the assets
   */
  constructor(
    IPoolAddressesProvider provider,
    address fallbackOracle,
    IAaveOracle mainOracle,
    address sValueFeed,
    uint256 stalenessThreshold,
    address[] memory assets,
    uint256[] memory pairIndexes
  ) {
    ADDRESSES_PROVIDER = provider;
    MAIN_ORACLE = mainOracle;
    _setStalenessThreshold(stalenessThreshold);
    _setFallbackOracle(fallbackOracle);
    _setAssetsPairIndexes(assets, pairIndexes);
    _setSValueFeed(sValueFeed);
    BASE_CURRENCY = mainOracle.BASE_CURRENCY();
    BASE_CURRENCY_UNIT = mainOracle.BASE_CURRENCY_UNIT();
    emit BaseCurrencySet(BASE_CURRENCY, BASE_CURRENCY_UNIT);
  }

  function setStalenessThreshold(uint256 stalenessThreshold) external onlyAssetListingOrPoolAdmins {
    _setStalenessThreshold(stalenessThreshold);
  }

  /**
   * @notice Sets a new staleness threshold
   * @param stalenessThreshold New staleness threshold in seconds; cannot be 0
   */
  function _setStalenessThreshold(uint256 stalenessThreshold) internal {
    if (stalenessThreshold == 0) {
      revert(Errors.STALENESS_THRESHOLD_NOT_ZERO);
    }
    _stalenessThreshold = stalenessThreshold;

    emit StalenessThresholdSet(stalenessThreshold);
  }

  /**
   * @dev Sets the asset sources for multiple assets.
   * @param assets The addresses of the assets.
   * @param pairIndexes The corresponding pair indexes for the assets.
   */
  function setAssetPairIndexes(
    address[] calldata assets,
    uint256[] memory pairIndexes
  ) external onlyAssetListingOrPoolAdmins {
    _setAssetsPairIndexes(assets, pairIndexes);
  }

  /// @inheritdoc IFallbackOracle
  function setFallbackOracle(
    address fallbackOracle
  ) external override onlyAssetListingOrPoolAdmins {
    _setFallbackOracle(fallbackOracle);
  }

  function setSValueFeed(address sValueFeed) external onlyAssetListingOrPoolAdmins {
    _setSValueFeed(sValueFeed);
  }

  /**
   * @dev Internal function to set the pair indexes for each asset
   * @param assets The addresses of the assets.
   * @param pairIndexes The index of the pair of each asset
   */
  function _setAssetsPairIndexes(address[] memory assets, uint256[] memory pairIndexes) internal {
    require(assets.length == pairIndexes.length, Errors.INCONSISTENT_PARAMS_LENGTH);
    for (uint256 i = 0; i < assets.length; i++) {
      existAssets[assets[i]] = true;
      assetsIndexes[assets[i]] = uint256(pairIndexes[i]);
      emit PairIndexUpdated(assets[i], pairIndexes[i]);
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

  /**
   * @notice Internal function to set the SValue feed
   * @param sValueFeed The address of the SValue Feed
   */
  function _setSValueFeed(address sValueFeed) internal {
    require(sValueFeed != address(0), Errors.ZERO_ADDRESS_NOT_VALID);
    _sValueFeed = ISupraSValueFeed(sValueFeed);
    emit SValueFeedUpdated(sValueFeed);
  }

  /**
   * @dev Retrieves the price of an asset.
   * @param asset The address of the asset.
   * @return The price of the asset.
   */
  /// @inheritdoc IPriceOracleGetter
  function getAssetPrice(address asset) public view override returns (uint256) {
    uint256 pairIndex = assetsIndexes[asset];
    bool existingPair = existAssets[asset];
    if (asset == BASE_CURRENCY) {
      return BASE_CURRENCY_UNIT;
    } else if (!existingPair) {
      return _fallbackOracle.getAssetPrice(asset);
    } else {
      ISupraSValueFeed.priceFeed memory priceStruct = _sValueFeed.getSvalue(pairIndex);
      if (block.timestamp - priceStruct.time / 1000 > _stalenessThreshold) {
        revert(Errors.ORACLE_ANSWER_IS_STALE);
      }
      if (priceStruct.price > 0) {
        return (priceStruct.price * BASE_CURRENCY_UNIT) / 10 ** priceStruct.decimals;
      } else {
        return _fallbackOracle.getAssetPrice(asset);
      }
    }
  }

  /// @inheritdoc IFallbackOracle
  function getAssetsPrices(
    address[] calldata assets
  ) external view override returns (uint256[] memory) {
    uint256[] memory prices = new uint256[](assets.length);
    for (uint256 i = 0; i < assets.length; i++) {
      prices[i] = getAssetPrice(assets[i]);
    }
    return prices;
  }

  function getPairIndexOfAsset(address asset) external view returns (uint256) {
    return assetsIndexes[asset];
  }

  /**
   * @return Current staleness threshold in seconds
   */
  function getStalenessThreshold() external view returns (uint256) {
    return _stalenessThreshold;
  }

  /// @inheritdoc IFallbackOracle
  function getFallbackOracle() external view returns (address) {
    return address(_fallbackOracle);
  }

  function getSValueFeed() external view returns (address) {
    return address(_sValueFeed);
  }

  function _onlyAssetListingOrPoolAdmins() internal view {
    IACLManager aclManager = IACLManager(ADDRESSES_PROVIDER.getACLManager());
    require(
      aclManager.isAssetListingAdmin(msg.sender) || aclManager.isPoolAdmin(msg.sender),
      Errors.CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN
    );
  }
}
