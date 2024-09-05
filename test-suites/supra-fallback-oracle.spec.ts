import { MOCK_CHAINLINK_AGGREGATORS_PRICES } from '@aave/deploy-v3/dist/helpers/constants';
import { expect } from 'chai';
import { oneEther, ONE_ADDRESS, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  deployMintableERC20,
  evmRevert,
  evmSnapshot,
  MintableERC20,
  MockPyth,
  MockSupra,
  PriceOracle,
  waitForTx,
} from '@aave/deploy-v3';
import { ethers } from 'hardhat';
import { BigNumber } from '@ethersproject/bignumber';
import { timeLatest } from '../helpers/misc-utils';

makeSuite('SupraFallbackOracle', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  let mockToken: MintableERC20;
  let mockTokenPairId: number;
  let assetPrice: bigint;
  let baseCurrencyUnit: BigNumber;

  before(async () => {
    const { fallbackOracle, aaveOracle } = testEnv;

    mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    mockTokenPairId = 2000;
    assetPrice = BigInt(ethers.utils.parseUnits('4000', 6).toString());
    baseCurrencyUnit = await aaveOracle.BASE_CURRENCY_UNIT();

    expect(await fallbackOracle.getStalenessThreshold()).to.eq(90 * 24 * 60 * 60);
  });

  it('Owner sets a new staleness threshold', async () => {
    const { poolAdmin, fallbackOracle } = testEnv;

    const newThreshold = 3600; // 1 hour in seconds

    // Set a new staleness threshold
    await expect(fallbackOracle.connect(poolAdmin.signer).setStalenessThreshold(newThreshold))
      .to.emit(fallbackOracle, 'StalenessThresholdSet')
      .withArgs(newThreshold);

    // Check if the staleness threshold has been updated
    expect(await fallbackOracle.getStalenessThreshold()).to.equal(newThreshold);
  });

  it('Owner tries to set a new staleness threshold with wrong zero value(revert expected)', async () => {
    const { poolAdmin, fallbackOracle } = testEnv;

    const newThreshold = 0;

    await expect(
      fallbackOracle.connect(poolAdmin.signer).setStalenessThreshold(newThreshold)
    ).to.be.revertedWith(ProtocolErrors.STALENESS_THRESHOLD_NOT_ZERO);
  });

  it('Owner sets staleness threshold to 0 (revert expected)', async () => {
    const { poolAdmin, fallbackOracle } = testEnv;

    // Try setting the staleness threshold to 0
    await expect(
      fallbackOracle.connect(poolAdmin.signer).setStalenessThreshold(0)
    ).to.be.revertedWith(ProtocolErrors.STALENESS_THRESHOLD_NOT_ZERO);
  });

  it('Get price of asset with stale data (revert expected)', async () => {
    const { fallbackOracle, supra } = testEnv;
    await fallbackOracle.setAssetPairIndexes([mockToken.address], [mockTokenPairId]);
    // Set a staleness threshold
    const stalenessThreshold = 3600; // 1 hour in seconds
    await fallbackOracle.setStalenessThreshold(stalenessThreshold);

    // Mock a timestamp that exceeds the staleness threshold
    const updatedAt = Math.floor(Date.now() / 1000) - stalenessThreshold - 1000;
    await supra.updateTime(mockTokenPairId, updatedAt);
    // Call getAssetPrice and expect a revert due to stale data
    await expect(fallbackOracle.getAssetPrice(mockToken.address)).to.be.revertedWith(
      ProtocolErrors.ORACLE_ANSWER_IS_STALE
    );
  });

  it('Owner get a new asset price feed with returned price has been rematched', async () => {
    const { poolAdmin, fallbackOracle, supra } = testEnv;
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    const mockTokenPairdId = 2001;
    // Regiter price for mockToken in Supra Oracle
    await supra.addPriceFeed(mockTokenPairdId, assetPrice);
    const priceFeed = await supra.getSvalue(mockTokenPairdId);

    // Asset has no pair index
    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(0);
    const priorSourcePrice = await fallbackOracle.getAssetPrice(mockToken.address);
    const priorSourcesPrices = (await fallbackOracle.getAssetsPrices([mockToken.address])).map(
      (x) => x.toString()
    );
    expect(priorSourcePrice).to.equal('0');
    expect(priorSourcesPrices).to.eql(['0']);

    // Add asset source
    expect(
      fallbackOracle
        .connect(poolAdmin.signer)
        .setAssetPairIndexes([mockToken.address], [mockTokenPairdId])
    )
      .to.emit(fallbackOracle, 'PairIndexUpdated')
      .withArgs(mockToken.address, mockTokenPairdId);

    const sourcesPrices = await (
      await fallbackOracle.getAssetsPrices([mockToken.address])
    ).map((x) => x.toString());

    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(mockTokenPairdId);

    expect(await fallbackOracle.getAssetPrice(mockToken.address)).to.be.eq(
      (assetPrice / BigInt(10) ** BigInt(priceFeed.decimals.toString())) *
        BigInt(baseCurrencyUnit.toString())
    );

    expect(sourcesPrices).to.eql([
      (
        (assetPrice / BigInt(10) ** BigInt(priceFeed.decimals.toString())) *
        BigInt(baseCurrencyUnit.toString())
      ).toString(),
    ]);
  });

  it('Owner update an existing asset price feed with returned price has been rematched', async () => {
    const { poolAdmin, fallbackOracle, dai, supra } = testEnv;
    const mockTokenPairdId = 2002;
    // DAI token has already a source
    const daiPairIndex = await fallbackOracle.getPairIndexOfAsset(dai.address);
    // Regiter price for mockToken in Supra Oracle
    expect(daiPairIndex).to.be.not.eq(0);
    await supra.addPriceFeed(mockTokenPairdId, assetPrice);
    const priceFeed = await supra.getSvalue(mockTokenPairdId);

    // Update DAI source
    await expect(
      fallbackOracle
        .connect(poolAdmin.signer)
        .setAssetPairIndexes([dai.address], [mockTokenPairdId])
    )
      .to.emit(fallbackOracle, 'PairIndexUpdated')
      .withArgs(dai.address, mockTokenPairdId);

    expect(await fallbackOracle.getPairIndexOfAsset(dai.address)).to.be.eq(mockTokenPairdId);
    expect(await fallbackOracle.getAssetPrice(dai.address)).to.be.eq(
      (assetPrice / BigInt(10) ** BigInt(priceFeed.decimals.toString())) *
        BigInt(baseCurrencyUnit.toString())
    );
  });

  it('Owner tries to set a new asset source with wrong input params (revert expected)', async () => {
    const { poolAdmin, fallbackOracle } = testEnv;

    await expect(
      fallbackOracle.connect(poolAdmin.signer).setAssetPairIndexes([mockToken.address], [])
    ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_PARAMS_LENGTH);
  });

  it('Get price of BASE_CURRENCY asset', async () => {
    const { fallbackOracle, aaveOracle } = testEnv;

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await fallbackOracle.getAssetPrice(await aaveOracle.BASE_CURRENCY())).to.be.eq(
      await fallbackOracle.BASE_CURRENCY_UNIT()
    );
  });

  it('A non-owner user tries to set a new asset price feed id (revert expected)', async () => {
    const { users, fallbackOracle } = testEnv;
    const user = users[0];
    const mockTokenPairdId = 2003;

    const { CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN } = ProtocolErrors;

    await expect(
      fallbackOracle
        .connect(user.signer)
        .setAssetPairIndexes([mockToken.address], [mockTokenPairdId])
    ).to.be.revertedWith(CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN);
  });

  it('Get price of BASE_CURRENCY asset with registered asset source for its address and returned price has been rematched', async () => {
    const { poolAdmin, fallbackOracle, weth, supra } = testEnv;
    const mockTokenPairdId = 2004;

    await supra.addPriceFeed(mockTokenPairdId, assetPrice);
    const priceFeed = await supra.getSvalue(mockTokenPairdId);

    // Add asset source for BASE_CURRENCY address
    await expect(
      fallbackOracle
        .connect(poolAdmin.signer)
        .setAssetPairIndexes([weth.address], [mockTokenPairdId])
    )
      .to.emit(fallbackOracle, 'PairIndexUpdated')
      .withArgs(weth.address, mockTokenPairdId);

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await fallbackOracle.getAssetPrice(weth.address)).to.be.eq(
      (assetPrice / BigInt(10) ** BigInt(priceFeed.decimals.toString())) *
        BigInt(baseCurrencyUnit.toString())
    );
  });

  it('Get price of asset with no asset source', async () => {
    const { fallbackOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(0);

    // Returns 0 price
    expect(await fallbackOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with 0 price and no fallback price', async () => {
    const { poolAdmin, fallbackOracle, supra } = testEnv;
    const mockTokenPairId = 2005;

    // await waitForTx(await fallbackOracle.setStalenessThreshold(90 * 24 * 60 * 60));
    // Update push price time
    await supra.updateTime(mockTokenPairId, await timeLatest());
    // Asset has no source
    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(0);

    // Add asset source
    await expect(
      fallbackOracle
        .connect(poolAdmin.signer)
        .setAssetPairIndexes([mockToken.address], [mockTokenPairId])
    )
      .to.emit(fallbackOracle, 'PairIndexUpdated')
      .withArgs(mockToken.address, mockTokenPairId);

    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(mockTokenPairId);
    expect(await fallbackOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with 0 price but non-zero fallback price', async () => {
    const { poolAdmin, fallbackOracle, supra } = testEnv;
    const mockTokenPairId = 2006;
    const fallbackPrice = BigInt(3000);

    // Register price on FallbackOracle
    expect(await supra.addPriceFeed(mockTokenPairId, fallbackPrice));
    const priceFeed = await supra.getSvalue(mockTokenPairId);

    // Asset has no source
    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(0);

    // Add asset source
    await expect(
      fallbackOracle
        .connect(poolAdmin.signer)
        .setAssetPairIndexes([mockToken.address], [mockTokenPairId])
    )
      .to.emit(fallbackOracle, 'PairIndexUpdated')
      .withArgs(mockToken.address, mockTokenPairId);

    expect(await fallbackOracle.getPairIndexOfAsset(mockToken.address)).to.be.eq(mockTokenPairId);
    expect(await fallbackOracle.getAssetPrice(mockToken.address)).to.be.eq(
      (fallbackPrice * BigInt(baseCurrencyUnit.toString())) /
        BigInt(10) ** BigInt(priceFeed.decimals.toString())
    );
  });

  it('Owner update the FallbackOracle', async () => {
    const { poolAdmin, fallbackOracle, oracle } = testEnv;

    expect(await fallbackOracle.getFallbackOracle()).to.be.eq(oracle.address);

    // Update oracle source
    await expect(fallbackOracle.connect(poolAdmin.signer).setFallbackOracle(ONE_ADDRESS))
      .to.emit(fallbackOracle, 'FallbackOracleUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await fallbackOracle.getFallbackOracle()).to.be.eq(ONE_ADDRESS);
  });

  it('Owner update the S Value Feed', async () => {
    const { poolAdmin, fallbackOracle, oracle, supra } = testEnv;

    expect(await fallbackOracle.getSValueFeed()).to.be.eq(supra.address);

    // Update oracle source
    await expect(fallbackOracle.connect(poolAdmin.signer).setSValueFeed(ONE_ADDRESS))
      .to.emit(fallbackOracle, 'SValueFeedUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await fallbackOracle.getSValueFeed()).to.be.eq(ONE_ADDRESS);
  });
});
