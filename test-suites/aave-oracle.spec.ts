import { MOCK_CHAINLINK_AGGREGATORS_PRICES } from '@aave/deploy-v3/dist/helpers/constants';
import { expect } from 'chai';
import { oneEther, ONE_ADDRESS, ZERO_ADDRESS, ZERO_BYTES32 } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  deployMintableERC20,
  evmRevert,
  evmSnapshot,
  MintableERC20,
  MOCK_PYTH_PRICE_FEED_ID,
  ZERO_BYTES_32,
} from '@aave/deploy-v3';

makeSuite('AaveOracle', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  let mockToken1: MintableERC20;
  let mockTokenPrice1: bigint;
  let mockTokenPairId1: number;

  let mockToken2: MintableERC20;
  let mockTokenPrice2: bigint;
  let mockTokenPairId2: number;
  let assetPrice: string;
  let priceFeedId: string;
  let aaveBaseCurrencyUnit: bigint;
  before(async () => {
    const { supra, fallbackOracle, aaveOracle } = testEnv;
    mockTokenPairId1 = 1000;
    mockTokenPrice1 = BigInt(34123);
    mockToken1 = await deployMintableERC20(['MOCK1', 'MOCK1', '18']);

    mockTokenPairId2 = 1001;
    mockTokenPrice2 = BigInt(32123);
    mockToken2 = await deployMintableERC20(['MOCK2', 'MOCK2', '18']);
    priceFeedId = MOCK_PYTH_PRICE_FEED_ID.ETH;
    assetPrice = MOCK_CHAINLINK_AGGREGATORS_PRICES.ETH;
    aaveBaseCurrencyUnit = await aaveOracle.BASE_CURRENCY_UNIT();
    // await aaveOracle.setFallbackOracle(fallback.address);
  });

  it('Assets with the price ids being set will return a price', async () => {
    const { aaveOracle, aave } = testEnv;
    expect(await aaveOracle.getPriceFeedIdOfAsset(aave.address)).to.be.eq(
      MOCK_PYTH_PRICE_FEED_ID.AAVE
    );
    expect(await aaveOracle.getAssetPrice(aave.address)).to.be.eq(
      MOCK_CHAINLINK_AGGREGATORS_PRICES.AAVE
    );
  });

  it("Users can retrieve an asset's price after setting its price feed id", async () => {
    const { poolAdmin, aaveOracle } = testEnv;

    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken1.address)).to.be.eq(ZERO_BYTES_32);

    console.log('mockToken1.address', mockToken1.address);

    const priorPrice = await aaveOracle.getAssetPrice(mockToken1.address);
    const priorPrices = (await aaveOracle.getAssetsPrices([mockToken1.address])).map((x) =>
      x.toString()
    );

    expect(priorPrice).to.equal('0');
    expect(priorPrices).to.eql(['0']);

    // Set price feed id
    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([mockToken1.address], [priceFeedId])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(mockToken1.address, priceFeedId);

    const sourcePrice = await aaveOracle.getAssetPrice(mockToken1.address);
    const sourcePrices = (await aaveOracle.getAssetsPrices([mockToken1.address])).map((x) =>
      x.toString()
    );

    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken1.address)).to.be.eq(priceFeedId);
    expect(sourcePrice).to.be.eq(assetPrice);
    expect(sourcePrices).to.be.eql([assetPrice]);
  });

  it('Assets without price ids will try calling to fallback oracle', async () => {
    const { aaveOracle, supra, fallbackOracle } = testEnv;
    // Set up price for mock token in Supra Data Feed
    await supra.addPriceFeed(mockTokenPairId2, mockTokenPrice2);
    await fallbackOracle.setAssetPairIndexes([mockToken2.address], [mockTokenPairId2]);
    const mockTokenPriceFeed2 = await supra.getSvalue(mockTokenPairId2);

    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken2.address)).to.be.eq(ZERO_BYTES_32);
    expect(await aaveOracle.getAssetPrice(mockToken2.address)).to.be.eq(
      (mockTokenPrice2 * BigInt(aaveBaseCurrencyUnit.toString())) /
        BigInt(10) ** BigInt(mockTokenPriceFeed2.decimals.toString())
    );
  });

  it('Owner set a new asset price feed id', async () => {
    const { poolAdmin, aaveOracle } = testEnv;
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);

    // Asset has no source
    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(ZERO_BYTES_32);

    const priorSourcePrice = await aaveOracle.getAssetPrice(mockToken.address);
    const priorSourcesPrices = (await aaveOracle.getAssetsPrices([mockToken.address])).map((x) =>
      x.toString()
    );
    expect(priorSourcePrice).to.equal('0');
    expect(priorSourcesPrices).to.eql(['0']);

    // Add asset source
    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([mockToken.address], [priceFeedId])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(mockToken.address, priceFeedId);

    const sourcesPrices = await (
      await aaveOracle.getAssetsPrices([mockToken.address])
    ).map((x) => x.toString());
    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(priceFeedId);
    console.log(await aaveOracle.getAssetPrice(mockToken.address));
    expect(await aaveOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
    expect(sourcesPrices).to.eql([assetPrice]);
  });

  it('Owner update an existing asset price feed id', async () => {
    const { poolAdmin, aaveOracle, dai } = testEnv;
    const mockPriceFeedId = '0x0000000000000000000000000000000000000000000000000000000000002000';
    // DAI token has already a source
    const daiSource = await aaveOracle.getPriceFeedIdOfAsset(dai.address);
    expect(daiSource).to.be.not.eq(ZERO_ADDRESS);

    // Update DAI source
    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([dai.address], [mockPriceFeedId])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(dai.address, mockPriceFeedId);

    expect(await aaveOracle.getPriceFeedIdOfAsset(dai.address)).to.be.eq(mockPriceFeedId);
  });

  it('Owner tries to set a new asset source with wrong input params (revert expected)', async () => {
    const { poolAdmin, aaveOracle } = testEnv;

    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([mockToken1.address], [])
    ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_PARAMS_LENGTH);
  });

  it('Get price of BASE_CURRENCY asset', async () => {
    const { aaveOracle } = testEnv;

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await aaveOracle.getAssetPrice(await aaveOracle.BASE_CURRENCY())).to.be.eq(
      await aaveOracle.BASE_CURRENCY_UNIT()
    );
  });

  it('A non-owner user tries to set a new asset source (revert expected)', async () => {
    const { users, aaveOracle } = testEnv;
    const user = users[0];
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    const mockPriceFeedId = '0x0000000000000000000000000000000000000000000000000000000000003000';

    const { CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN } = ProtocolErrors;

    await expect(
      aaveOracle.connect(user.signer).setAssetPriceFeedIds([mockToken.address], [mockPriceFeedId])
    ).to.be.revertedWith(CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN);
  });

  it('Get price of BASE_CURRENCY asset with registered asset source for its address', async () => {
    const { poolAdmin, aaveOracle, weth } = testEnv;

    // Add asset source for BASE_CURRENCY address
    await expect(
      aaveOracle
        .connect(poolAdmin.signer)
        .setAssetPriceFeedIds([weth.address], [MOCK_PYTH_PRICE_FEED_ID['WETH']])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(weth.address, MOCK_PYTH_PRICE_FEED_ID['WETH']);

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await aaveOracle.getAssetPrice(weth.address)).to.be.eq(
      MOCK_CHAINLINK_AGGREGATORS_PRICES.WETH
    );
  });

  it('Get price of asset with no asset price feed Id', async () => {
    const { aaveOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(ZERO_BYTES32);

    // Returns 0 price
    expect(await aaveOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with 0 price and no fallback price', async () => {
    const { poolAdmin, aaveOracle, pyth, fallbackOracle, oracle } = testEnv;
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    const mockBytes32 = '0x0000000000000000000000000000000000000000000000000000000000005000';
    // Set fallback for hardhat fallback oracle and set fallback to zero
    await fallbackOracle.setFallbackOracle(oracle.address);
    // Asset has no source
    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(ZERO_BYTES32);

    // Add asset source
    await pyth.setPrice(mockBytes32, 0);
    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([mockToken.address], [mockBytes32])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(mockToken.address, mockBytes32);

    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(mockBytes32);
    expect(await aaveOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with 0 price but non-zero fallback price', async () => {
    const { poolAdmin, aaveOracle, supra, pyth, fallbackOracle } = testEnv;
    const mockTokenPairdId = 1234;
    const mockTokenPrice = BigInt(1111);
    const mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    const mockBytes32 = '0x0000000000000000000000000000000000000000000000000000000000006000';

    // Register price 0 on Pyth
    expect(await pyth.setPrice(mockBytes32, 0));
    expect(await aaveOracle.setAssetPriceFeedIds([mockToken.address], [mockBytes32]));

    // Register price on FallbackOracle
    expect(await fallbackOracle.setAssetPairIndexes([mockToken.address], [mockTokenPairdId]));
    expect(await supra.addPriceFeed(mockTokenPairdId, mockTokenPrice));

    // Asset has no source
    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(mockBytes32);
    const mockTokenPriceFeed = await supra.getSvalue(mockTokenPairdId);

    // Add asset source
    await expect(
      aaveOracle.connect(poolAdmin.signer).setAssetPriceFeedIds([mockToken.address], [mockBytes32])
    )
      .to.emit(aaveOracle, 'AssetPriceFeedIdUpdated')
      .withArgs(mockToken.address, mockBytes32);

    expect(await aaveOracle.getPriceFeedIdOfAsset(mockToken.address)).to.be.eq(mockBytes32);
    expect(await aaveOracle.getAssetPrice(mockToken.address)).to.be.eq(
      (mockTokenPrice * BigInt(aaveBaseCurrencyUnit.toString())) /
        BigInt(10) ** BigInt(mockTokenPriceFeed.decimals.toString())
    );
  });

  it('Owner update the FallbackOracle', async () => {
    const { poolAdmin, aaveOracle, fallbackOracle } = testEnv;

    expect(await aaveOracle.getFallbackOracle()).to.be.eq(fallbackOracle.address);

    // Update oracle source
    await expect(aaveOracle.connect(poolAdmin.signer).setFallbackOracle(ONE_ADDRESS))
      .to.emit(aaveOracle, 'FallbackOracleUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await aaveOracle.getFallbackOracle()).to.be.eq(ONE_ADDRESS);
  });
});
