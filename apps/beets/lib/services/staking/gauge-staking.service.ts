import { AmountHumanReadable, TokenBase } from '~/lib/services/token/token-types';
import { BaseProvider } from '@ethersproject/providers';
import LiquidityGaugeV5Abi from '~/lib/abi/LiquidityGaugeV5.json';
import LiquidityGaugeV6Abi from '~/lib/abi/LiquidityGaugeV6.json';
import ChildChainGaugeRewardHelper from '~/lib/abi/ChildChainGaugeRewardHelper.json';
import { BigNumber, Contract } from 'ethers';
import { formatFixed } from '@ethersproject/bignumber';
import ERC20Abi from '~/lib/abi/ERC20.json';
import { Multicaller } from '~/lib/services/util/multicaller.service';
import { GqlPoolStakingGauge } from '~/apollo/generated/graphql-codegen-generated';
import { networkConfig } from '~/lib/config/network-config';
import { StakingPendingRewardAmount } from '~/lib/services/staking/staking-types';
import { BatchRelayerService, batchRelayerService } from '../batch-relayer/batch-relayer.service';
import { mapValues } from 'lodash';

interface GetUserStakedBalanceInput {
    userAddress: string;
    gaugeAddress: string;
    provider: BaseProvider;
    decimals?: number;
}

export class GaugeStakingService {
    constructor(
        private readonly chainId: string,
        private readonly gaugeRewardHelperAddress: string,
        private readonly batchRelayerService: BatchRelayerService,
    ) {}

    public async getUserStakedBalance({
        userAddress,
        provider,
        gaugeAddress,
        decimals = 18,
    }: GetUserStakedBalanceInput): Promise<AmountHumanReadable> {
        const gaugeContract = new Contract(gaugeAddress, LiquidityGaugeV5Abi, provider);
        const balance = await gaugeContract.balanceOf(userAddress);

        return formatFixed(balance, decimals);
    }

    public async getGaugeTokenBalance({
        tokenAddress,
        gaugeAddress,
        provider,
        decimals = 18,
    }: {
        tokenAddress: string;
        gaugeAddress: string;
        provider: BaseProvider;
        decimals?: number;
    }): Promise<AmountHumanReadable> {
        const tokenContract = new Contract(tokenAddress, ERC20Abi, provider);
        const response: BigNumber = await tokenContract.balanceOf(gaugeAddress);

        return formatFixed(response, decimals);
    }

    public async getPendingRewards({
        userAddress,
        gauges,
        tokens,
        provider,
    }: {
        userAddress: string;
        gauges: GqlPoolStakingGauge[];
        tokens: TokenBase[];
        provider: BaseProvider;
    }): Promise<StakingPendingRewardAmount[]> {
        const v1Multicaller = new Multicaller(this.chainId, provider, ChildChainGaugeRewardHelper);
        const v2Multicaller = new Multicaller(this.chainId, provider, LiquidityGaugeV6Abi);

        const v1Gauges = gauges.filter((g) => g.version === 1);
        const v2Gauges = gauges.filter((g) => g.version === 2);

        for (const gauge of v1Gauges) {
            for (const reward of gauge.rewards) {
                v1Multicaller.call(
                    `${gauge.id}.${reward.tokenAddress}`,
                    this.gaugeRewardHelperAddress,
                    'pendingRewards',
                    [gauge.gaugeAddress, userAddress, reward.tokenAddress],
                );
            }
        }

        for (const gauge of v2Gauges) {
            for (const reward of gauge.rewards) {
                v2Multicaller.call(`${gauge.id}.${reward.tokenAddress}`, gauge.gaugeAddress, 'claimable_reward', [
                    userAddress,
                    reward.tokenAddress,
                ]);
            }
        }

        if (v1Multicaller.numCalls === 0 && v2Multicaller.numCalls === 0) {
            return [];
        }

        const v1Result: {
            [gaugeId: string]: {
                [tokenAddress: string]: BigNumber;
            };
        } = await v1Multicaller.execute({});

        const v2Result: {
            [gaugeId: string]: {
                [tokenAddress: string]: BigNumber;
            };
        } = await v2Multicaller.execute({});

        const pendingRewardAmounts: StakingPendingRewardAmount[] = [];

        for (const gauge of gauges) {
            for (const reward of gauge.rewards) {
                if (v1Result && (v1Result[gauge.id] || {})[reward.tokenAddress]) {
                    const token = tokens.find((token) => token.address === reward.tokenAddress.toLowerCase());
                    pendingRewardAmounts.push({
                        address: reward.tokenAddress,
                        amount: formatFixed(v1Result[gauge.id][reward.tokenAddress], token?.decimals || 18),
                        id: gauge.id,
                    });
                }
                if (v2Result && (v2Result[gauge.id] || {})[reward.tokenAddress]) {
                    const token = tokens.find((token) => token.address === reward.tokenAddress.toLowerCase());
                    pendingRewardAmounts.push({
                        address: reward.tokenAddress,
                        amount: formatFixed(v2Result[gauge.id][reward.tokenAddress], token?.decimals || 18),
                        id: gauge.id,
                    });
                }
            }
        }

        return pendingRewardAmounts;
    }

    public async getPendingBALRewards({
        userAddress,
        gauges,
        provider,
    }: {
        userAddress: string;
        gauges: string[];
        provider: BaseProvider;
    }) {
        const multicaller = new Multicaller(this.chainId, provider, LiquidityGaugeV6Abi);

        for (const gauge of gauges) {
            multicaller.call(`${gauge}.claimableBAL`, gauge, 'claimable_tokens', [userAddress]);
        }

        if (multicaller.numCalls === 0) {
            return {};
        }

        const result: {
            [gaugeId: string]: {
                claimableBAL: BigNumber;
            };
        } = await multicaller.execute({});

        const formattedResult = mapValues(result, (data) => formatFixed(data.claimableBAL.toString(), 18).toString());
        return formattedResult;
    }
}

export const gaugeStakingService = new GaugeStakingService(
    networkConfig.chainId,
    networkConfig.gauge.rewardHelperAddress,
    batchRelayerService,
);
