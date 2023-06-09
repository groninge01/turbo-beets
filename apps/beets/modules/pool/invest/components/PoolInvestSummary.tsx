import { Box, BoxProps, Heading, HStack, VStack } from '@chakra-ui/react';
import { AprTooltip } from 'components';
import { numberFormatUSDValue } from '~/lib/util/number-formats';
import { useInvest } from '~/modules/pool/invest/lib/useInvest';
import { usePool } from '~/modules/pool/lib/usePool';
import React from 'react';

interface Props extends BoxProps {}

export function PoolInvestSummary({ ...rest }: Props) {
    const { pool, totalApr } = usePool();
    const { totalInvestValue } = useInvest();
    const weeklyYield = (totalInvestValue * totalApr) / 52;

    return (
        <VStack spacing="4" width="full" p="4" rounded="md">
            <HStack spacing="8">
                <Box>
                    <Heading size="sm" textAlign="center">
                        Your investment total is
                    </Heading>
                    <Heading color="beets.green" textAlign="center">
                        {numberFormatUSDValue(totalInvestValue)}
                    </Heading>
                </Box>
                <Box>
                    <Heading size="sm" textAlign="center">
                        Potential weekly yield
                    </Heading>
                    <HStack justifyContent="center">
                        <Heading color="beets.highlight" textAlign="center">
                            {numberFormatUSDValue(weeklyYield)}
                        </Heading>
                        <AprTooltip data={pool.dynamicData.apr} onlySparkles={true} sparklesSize="sm" />
                    </HStack>
                </Box>
            </HStack>
        </VStack>
    );
}