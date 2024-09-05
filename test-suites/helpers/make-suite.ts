import { Signer } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import {
  getPool,
  getPoolAddressesProvider,
  getAaveProtocolDataProvider,
  getAToken,
  getMintableERC20,
  getPoolConfiguratorProxy,
  getPoolAddressesProviderRegistry,
  getWETHMocked,
  getVariableDebtToken,
  getStableDebtToken,
  getAaveOracle,
  getACLManager,
} from '@aave/deploy-v3/dist/helpers/contract-getters';
import {
  waitForTx,
  evmSnapshot,
  evmRevert,
  getEthersSigners,
  deployPriceOracle,
  Faucet,
  getFaucet,
  MockPyth,
  MockSupra,
  getMockPyth,
  getMockSupra,
  getSupraFallbackOracle,
} from '@aave/deploy-v3';
import { Pool } from '../../types/Pool';
import { AaveProtocolDataProvider } from '../../types/AaveProtocolDataProvider';
import { MintableERC20 } from '../../types/MintableERC20';
import { AToken } from '../../types/AToken';
import { PoolConfigurator } from '../../types/PoolConfigurator';
import { PriceOracle } from '../../types/PriceOracle';
import { PoolAddressesProvider } from '../../types/PoolAddressesProvider';
import { PoolAddressesProviderRegistry } from '../../types/PoolAddressesProviderRegistry';
import { WETH9Mocked } from '../../types/WETH9Mocked';
import { SupraFallbackOracle } from '../../types/SupraFallbackOracle';
import { AaveOracle, ACLManager, StableDebtToken, VariableDebtToken } from '../../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { tEthereumAddress } from '../../helpers/types';
import Bluebird from 'bluebird';

declare var hre: HardhatRuntimeEnvironment;

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}
export interface TestEnv {
  deployer: SignerWithAddress;
  poolAdmin: SignerWithAddress;
  emergencyAdmin: SignerWithAddress;
  riskAdmin: SignerWithAddress;
  users: SignerWithAddress[];
  pool: Pool;
  configurator: PoolConfigurator;
  oracle: PriceOracle;
  aaveOracle: AaveOracle;
  helpersContract: AaveProtocolDataProvider;
  weth: WETH9Mocked;
  aWETH: AToken;
  faucetMintable: Faucet;
  dai: MintableERC20;
  aDai: AToken;
  aAave: AToken;
  variableDebtDai: VariableDebtToken;
  stableDebtDai: StableDebtToken;
  aUsdc: AToken;
  usdc: MintableERC20;
  aave: MintableERC20;
  addressesProvider: PoolAddressesProvider;
  registry: PoolAddressesProviderRegistry;
  aclManager: ACLManager;
  supra: MockSupra;
  pyth: MockPyth;
  fallbackOracle: SupraFallbackOracle;
}

let HardhatSnapshotId: string = '0x1';
const setHardhatSnapshotId = (id: string) => {
  HardhatSnapshotId = id;
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  poolAdmin: {} as SignerWithAddress,
  emergencyAdmin: {} as SignerWithAddress,
  riskAdmin: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  pool: {} as Pool,
  configurator: {} as PoolConfigurator,
  helpersContract: {} as AaveProtocolDataProvider,
  oracle: {} as PriceOracle,
  aaveOracle: {} as AaveOracle,
  fallbackOracle: {} as SupraFallbackOracle,
  weth: {} as WETH9Mocked,
  aWETH: {} as AToken,
  faucetMintable: {} as Faucet,
  dai: {} as MintableERC20,
  aDai: {} as AToken,
  variableDebtDai: {} as VariableDebtToken,
  stableDebtDai: {} as StableDebtToken,
  aUsdc: {} as AToken,
  usdc: {} as MintableERC20,
  aave: {} as MintableERC20,
  addressesProvider: {} as PoolAddressesProvider,
  registry: {} as PoolAddressesProviderRegistry,
  aclManager: {} as ACLManager,
  pyth: {} as MockPyth,
  supra: {} as MockSupra,
} as TestEnv;

export async function initializeMakeSuite() {
  /// @notice Get signers' address and admins
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }

  testEnv.deployer = deployer;
  testEnv.poolAdmin = deployer;
  testEnv.emergencyAdmin = testEnv.users[1];
  testEnv.riskAdmin = testEnv.users[2];

  /// @notice Get Aave's contract
  testEnv.pool = await getPool();
  testEnv.configurator = await getPoolConfiguratorProxy();
  testEnv.addressesProvider = await getPoolAddressesProvider();
  testEnv.registry = await getPoolAddressesProviderRegistry();
  testEnv.aclManager = await getACLManager();

  /// @notice Oracle relating contracts
  testEnv.oracle = await deployPriceOracle();
  testEnv.aaveOracle = await getAaveOracle();
  // testEnv.aaveOracle = await getAaveOracle();

  // - Deploy MockPyth and MockSupra
  testEnv.pyth = await getMockPyth();
  testEnv.supra = await getMockSupra();
  testEnv.fallbackOracle = await getSupraFallbackOracle();

  testEnv.helpersContract = await getAaveProtocolDataProvider();

  const allTokens = await testEnv.helpersContract.getAllATokens();
  const aDaiAddress = allTokens.find((aToken) => aToken.symbol.includes('DAI'))?.tokenAddress;
  const aUsdcAddress = allTokens.find((aToken) => aToken.symbol.includes('USDC'))?.tokenAddress;
  const aWEthAddress = allTokens.find((aToken) => aToken.symbol.includes('WETH'))?.tokenAddress;
  const aAaveAddress = allTokens.find((aToken) => aToken.symbol.includes('AAVE'))?.tokenAddress;

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();

  const daiAddress = reservesTokens.find((token) => token.symbol === 'DAI')?.tokenAddress;
  const {
    variableDebtTokenAddress: variableDebtDaiAddress,
    stableDebtTokenAddress: stableDebtDaiAddress,
  } = await testEnv.helpersContract.getReserveTokensAddresses(daiAddress || '');
  const usdcAddress = reservesTokens.find((token) => token.symbol === 'USDC')?.tokenAddress;
  const aaveAddress = reservesTokens.find((token) => token.symbol === 'AAVE')?.tokenAddress;
  const wethAddress = reservesTokens.find((token) => token.symbol === 'WETH')?.tokenAddress;

  if (!aDaiAddress || !aWEthAddress) {
    throw 'Missing mandatory atokens';
  }
  if (!daiAddress || !usdcAddress || !aaveAddress || !wethAddress) {
    throw 'Missing mandatory tokens';
  }

  testEnv.faucetMintable = await getFaucet();
  testEnv.aDai = await getAToken(aDaiAddress);
  testEnv.variableDebtDai = await getVariableDebtToken(variableDebtDaiAddress);
  testEnv.stableDebtDai = await getStableDebtToken(stableDebtDaiAddress);
  testEnv.aUsdc = await getAToken(aUsdcAddress);
  testEnv.aWETH = await getAToken(aWEthAddress);
  testEnv.aAave = await getAToken(aAaveAddress);

  testEnv.dai = await getMintableERC20(daiAddress);
  testEnv.aave = await getMintableERC20(aaveAddress);
  testEnv.usdc = await getMintableERC20(usdcAddress);
  testEnv.weth = await getWETHMocked(wethAddress);

  // Support direct minting
  const testReserves = reservesTokens.map((x) => x.tokenAddress);
  await waitForTx(await testEnv.faucetMintable.setProtectedOfChild(testReserves, false));

  // Setup admins
  await waitForTx(await testEnv.aclManager.addRiskAdmin(testEnv.riskAdmin.address));
  await waitForTx(await testEnv.aclManager.addEmergencyAdmin(testEnv.emergencyAdmin.address));
  // Set Pyth in PoolAddressesProvider
  await waitForTx(await testEnv.addressesProvider.setPyth(testEnv.pyth.address));

  // Set sValueFeed of fallback to Supra
  await waitForTx(await testEnv.fallbackOracle.setSValueFeed(testEnv.supra.address));

  // Setup fallbackOracle
  await waitForTx(await testEnv.aaveOracle.setFallbackOracle(testEnv.fallbackOracle.address));

  for (const testReserve of testReserves) {
    const price = await testEnv.aaveOracle.getAssetPrice(testReserve);
    console.log('price', price);
    await waitForTx(await testEnv.oracle.setAssetPrice(testReserve, price));
  }

  // await waitForTx(await testEnv.aaveOracle.setFallbackOracle(testEnv.oracle.address));
  await waitForTx(await testEnv.fallbackOracle.setFallbackOracle(testEnv.oracle.address));
}

const setSnapshot = async () => {
  if (usingTenderly()) {
    setHardhatSnapshotId((await hre.tenderlyNetwork.getHead()) || '0x1');
    return;
  }
  setHardhatSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (usingTenderly()) {
    await hre.tenderlyNetwork.setHead(HardhatSnapshotId);
    return;
  }
  await evmRevert(HardhatSnapshotId);
};

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      await setSnapshot();
    });
    tests(testEnv);
    after(async () => {
      await revertHead();
    });
  });
}
